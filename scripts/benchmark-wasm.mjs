import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { basename, dirname, join, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createCompiler } from "../../ilic-fork/packages/compiler-wasm/index.js";
import { RepositoryManager } from "../../ilic-fork/packages/tools/index.js";
import { NodeFileCache } from "../../ilic-fork/packages/tools/node.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localModelPath = resolve(
  projectRoot,
  "examples/dev-workspace/LocalCatalog.ili",
);

const LOCAL_URI = "memory:///LocalCatalog.ili";
const REMOTE_MODEL = "SO_Nutzungsplanung_20171118";
const REMOTE_ROOT_URI =
  "https://geo.so.ch/models/ARP/SO_Nutzungsplanung_20171118.ili";
const REMOTE_REPOSITORIES = [
  "https://geo.so.ch/models/",
  "https://models.geo.admin.ch/",
  "https://models.interlis.ch/",
];
const REMOTE_SUPPLEMENTAL_MODELS = [
  "InternationalCodes_V1",
  "Localisation_V1",
  "Dictionaries_V1",
  "LocalisationCH_V1",
];
const OPERATIONS = ["parse", "analyze", "compile", "compileAndAnalyze"];
const WARM_ITERATIONS = 10;
const NATIVE_OPERATION = "compile";
const execFileAsync = promisify(execFile);
const nativeIlicCandidates = [
  resolve(projectRoot, "../ilic-fork/build/static/ilic"),
  resolve(projectRoot, "../ilic-fork/build/final/ilic"),
  resolve(projectRoot, "../ilic-fork/build/macos/ilic"),
];
const defaultIli2cJarPath = "/Users/stefan/apps/ili2c-5.6.8/ili2c.jar";
const REMOTE_NATIVE_SOURCE_ORDER = [
  "CHBase_Part2_LOCALISATION_V1.ili",
  "Units-20120220.ili",
  "CoordSys-20151124.ili",
  "CHBase_Part1_GEOMETRY_V1.ili",
  "CHBase_Part4_ADMINISTRATIVEUNITS_V1.ili",
  "SO_Nutzungsplanung_20171118.ili",
];

function now() {
  return performance.now();
}

function elapsed(start) {
  return now() - start;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function byteLength(source) {
  return typeof source === "string"
    ? Buffer.byteLength(source, "utf8")
    : source.byteLength;
}

function resolveConfiguredPath(value) {
  return value ? resolve(value) : undefined;
}

function findNativeIlicPath() {
  const configuredPath = resolveConfiguredPath(process.env.ILIC_NATIVE_PATH);
  if (configuredPath) return configuredPath;
  return nativeIlicCandidates.find((candidate) => existsSync(candidate));
}

function getNativeCompilers() {
  const ilicPath = findNativeIlicPath();
  const ili2cJarPath =
    resolveConfiguredPath(process.env.ILI2C_JAR) ?? defaultIli2cJarPath;
  return [
    {
      id: "ilic",
      label: "ilic",
      kind: "ilic",
      path: ilicPath,
      available: Boolean(ilicPath && existsSync(ilicPath)),
      unavailableReason:
        ilicPath && existsSync(ilicPath)
          ? undefined
          : `ilic-Binary nicht gefunden: ${ilicPath ?? "ILIC_NATIVE_PATH oder bekannte Buildpfade"}`,
    },
    {
      id: "ili2c",
      label: "ili2c 5.6.8",
      kind: "ili2c",
      path: ili2cJarPath,
      java: "java",
      available: existsSync(ili2cJarPath),
      unavailableReason: existsSync(ili2cJarPath)
        ? undefined
        : `ili2c-JAR nicht gefunden: ${ili2cJarPath}`,
    },
  ];
}

async function executeCommand(command, args) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      exitCode: Number.isInteger(error.code) ? error.code : null,
      stdout: typeof error.stdout === "string" ? error.stdout : "",
      stderr: typeof error.stderr === "string" ? error.stderr : "",
      error: errorMessage(error),
    };
  }
}

async function nativeCompilerVersion(compiler) {
  if (!compiler.available) return null;
  const command = compiler.kind === "ilic" ? compiler.path : compiler.java;
  const args =
    compiler.kind === "ilic"
      ? ["--version"]
      : ["-jar", compiler.path, "--version"];
  const result = await executeCommand(command, args);
  const output = `${result.stdout}\n${result.stderr}`.trim();
  return output.split(/\r?\n/, 1)[0] || null;
}

function nativeCommand(compiler, sourcePaths) {
  if (compiler.kind === "ilic")
    return {
      command: compiler.path,
      args: ["-no_auto", "-quiet", ...sourcePaths],
    };
  return {
    command: compiler.java,
    args: ["-jar", compiler.path, "--no-auto", "--quiet", ...sourcePaths],
  };
}

function normalizeLegacyMetaAttributes(source) {
  let normalizedCount = 0;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const normalizedLines = [];
  for (const line of lines) {
    const assignment = line.match(/^(\s*)!!@\s*([^\s=]+)\s*=\s*(.*?)\s*$/);
    if (assignment) {
      normalizedCount++;
      normalizedLines.push(
        `${assignment[1]}!!@ ${assignment[2]}=${assignment[3]}`,
      );
      continue;
    }

    const continuation = line.match(/^(\s*)!!@\s+(.+)$/);
    const previous = normalizedLines.at(-1);
    if (continuation && previous && /^\s*!!@\s+[^=]+=.*/.test(previous)) {
      normalizedCount++;
      normalizedLines[normalizedLines.length - 1] =
        `${previous.trimEnd()} ${continuation[2].trim()}`;
      continue;
    }
    normalizedLines.push(line);
  }
  return { source: normalizedLines.join(newline), normalizedCount };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function operationResult(result, operation) {
  if (operation !== "compileAndAnalyze") return result;
  return result.compilation;
}

function resultSummary(result, operation) {
  const compilation = operationResult(result, operation);
  const semanticDiagnostics =
    operation === "compileAndAnalyze" ? result.semantic.diagnostics : [];
  const diagnostics = [...compilation.diagnostics, ...semanticDiagnostics];
  const errors = diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "error" || diagnostic.treatedAsError,
  );
  const warnings = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  );
  return {
    success:
      operation === "compileAndAnalyze"
        ? result.compilation.success && result.semantic.success
        : result.success,
    compilerVersion: result.compilerVersion,
    errorCount: errors.length,
    warningCount: warnings.length,
    diagnosticMessages: [
      ...new Set(diagnostics.map((diagnostic) => diagnostic.message)),
    ],
  };
}

function invoke(session, operation, rootUri) {
  switch (operation) {
    case "parse":
      return session.parse(rootUri);
    case "analyze":
      return session.analyze({ roots: [rootUri] });
    case "compile":
      return session.compile({ roots: [rootUri] });
    case "compileAndAnalyze":
      return session.compileAndAnalyze({ roots: [rootUri] });
    default:
      throw new Error(`unknown benchmark operation ${operation}`);
  }
}

function operationLabel(operation) {
  return operation === "compileAndAnalyze" ? "Compile+Analyze" : operation;
}

async function prepareLocal() {
  const start = now();
  const rawSource = await readFile(localModelPath, "utf8");
  const invalidRange = "0..-9";
  const validRange = "-9..0";
  const rangeCount = rawSource.split(invalidRange).length - 1;
  assert(
    rangeCount === 1,
    `erwartete genau eine LocalCatalog-Benchmark-Korrektur, gefunden: ${rangeCount}`,
  );
  const source = rawSource.replace(invalidRange, validRange);
  return {
    rootUri: LOCAL_URI,
    sources: [{ uri: LOCAL_URI, source }],
    sourceCount: 1,
    sourceBytes: byteLength(source),
    rawSourceBytes: byteLength(rawSource),
    resolutionMs: elapsed(start),
    normalizationMs: 0,
    normalizedMetaAttributes: 0,
    sourceTransform: `${invalidRange} -> ${validRange}`,
    cacheHits: null,
  };
}

async function prepareRemote(cacheDirectory) {
  const start = now();
  const repositories = new RepositoryManager({
    repositories: REMOTE_REPOSITORIES,
    cache: new NodeFileCache(cacheDirectory),
    followSiteLinks: false,
    allowStaleOnError: false,
    validateChecksums: true,
  });
  const workspace = await repositories.resolveWorkspace(
    [REMOTE_MODEL, ...REMOTE_SUPPLEMENTAL_MODELS],
    "ili2_3",
  );
  const root = workspace.models.find(
    (model) => model.metadata.name === REMOTE_MODEL,
  );
  assert(root, `resolved workspace has no root model ${REMOTE_MODEL}`);
  assert(
    root.uri === REMOTE_ROOT_URI,
    `resolved root URI ${root.uri} does not match ${REMOTE_ROOT_URI}`,
  );

  const resolutionMs = elapsed(start);
  const normalizationStart = now();
  let normalizedMetaAttributes = 0;
  const sources = workspace.models.map(({ uri, source }) => {
    const normalized = normalizeLegacyMetaAttributes(source);
    normalizedMetaAttributes += normalized.normalizedCount;
    return { uri, source: normalized.source };
  });

  return {
    rootUri: root.uri,
    sources,
    sourceCount: workspace.models.length,
    sourceBytes: sources.reduce(
      (total, model) => total + byteLength(model.source),
      0,
    ),
    rawSourceBytes: workspace.models.reduce(
      (total, model) => total + byteLength(model.source),
      0,
    ),
    resolutionMs,
    normalizationMs: elapsed(normalizationStart),
    normalizedMetaAttributes,
    sourceTransform: "legacy !!@ metadata syntax normalized",
    cacheHits: workspace.models.filter((model) => model.fromCache).length,
  };
}

const models = [
  {
    id: "local",
    label: "LocalCatalog.ili (temporär gültige Kopie)",
    prepare: () => prepareLocal(),
  },
  {
    id: "so-nutzungsplanung",
    label: REMOTE_MODEL,
    prepare: (cacheDirectory) => prepareRemote(cacheDirectory),
  },
];

function sourceFileName(uri) {
  try {
    return basename(new URL(uri).pathname);
  } catch {
    return basename(uri);
  }
}

function orderedNativeSources(model, input) {
  if (model.id === "local") return input.sources;

  const sourcesByName = new Map(
    input.sources.map((source) => [sourceFileName(source.uri), source]),
  );
  return REMOTE_NATIVE_SOURCE_ORDER.map((name) => {
    const source = sourcesByName.get(name);
    assert(source, `native Benchmark-Quelle fehlt: ${name}`);
    return source;
  });
}

async function materializeNativeSources(model, input, directory) {
  const sourcePaths = [];
  for (const [index, source] of orderedNativeSources(model, input).entries()) {
    const name =
      model.id === "local"
        ? "LocalCatalog.benchmark.ili"
        : sourceFileName(source.uri);
    const path = join(directory, `${String(index).padStart(2, "0")}-${name}`);
    await writeFile(path, source.source, "utf8");
    sourcePaths.push(path);
  }
  return sourcePaths;
}

async function measureSample({ model, operation, compiler, cacheDirectory }) {
  const totalStart = now();
  let input;
  let setupMs = null;
  let operationMs = null;
  let session;

  try {
    input = await model.prepare(cacheDirectory);
    const setupStart = now();
    session = compiler.createSession();
    for (const source of input.sources)
      session.putSource(source.uri, source.source, 1);
    setupMs = elapsed(setupStart);

    const operationStart = now();
    const result = invoke(session, operation, input.rootUri);
    operationMs = elapsed(operationStart);
    const summary = resultSummary(result, operation);
    return {
      valid: summary.success,
      totalMs: elapsed(totalStart),
      resolutionMs: input.resolutionMs,
      setupMs,
      operationMs,
      sourceCount: input.sourceCount,
      sourceBytes: input.sourceBytes,
      rawSourceBytes: input.rawSourceBytes,
      cacheHits: input.cacheHits,
      normalizationMs: input.normalizationMs,
      normalizedMetaAttributes: input.normalizedMetaAttributes,
      sourceTransform: input.sourceTransform,
      ...summary,
    };
  } catch (error) {
    return {
      valid: false,
      totalMs: elapsed(totalStart),
      resolutionMs: input?.resolutionMs ?? null,
      setupMs,
      operationMs,
      sourceCount: input?.sourceCount ?? null,
      sourceBytes: input?.sourceBytes ?? null,
      rawSourceBytes: input?.rawSourceBytes ?? null,
      cacheHits: input?.cacheHits ?? null,
      normalizationMs: input?.normalizationMs ?? null,
      normalizedMetaAttributes: input?.normalizedMetaAttributes ?? null,
      sourceTransform: input?.sourceTransform ?? null,
      error: errorMessage(error),
    };
  } finally {
    session?.dispose();
  }
}

function nativeDiagnosticMessages(result) {
  return [...new Set(`${result.stdout}\n${result.stderr}`.split(/\r?\n/))]
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20);
}

async function measureNativeSample({ model, compiler, cacheDirectory }) {
  const totalStart = now();
  let input;
  let materializationMs = null;
  let processMs = null;
  let sourcePaths;
  let nativeDirectory;

  try {
    input = await model.prepare(cacheDirectory);
    const materializationStart = now();
    nativeDirectory = await createTemporaryDirectory(
      `${model.id}-${compiler.id}`,
    );
    sourcePaths = await materializeNativeSources(model, input, nativeDirectory);
    materializationMs = elapsed(materializationStart);

    const { command, args } = nativeCommand(compiler, sourcePaths);
    const processStart = now();
    const result = await executeCommand(command, args);
    processMs = elapsed(processStart);
    const diagnosticMessages = nativeDiagnosticMessages(result);
    const warningCount = diagnosticMessages.filter((message) =>
      /warning/i.test(message),
    ).length;
    const errorCount =
      result.exitCode === 0
        ? 0
        : Math.max(
            1,
            diagnosticMessages.filter((message) => /error/i.test(message))
              .length,
          );

    return {
      valid: result.exitCode === 0,
      totalMs: elapsed(totalStart),
      resolutionMs: input.resolutionMs,
      normalizationMs: input.normalizationMs,
      materializationMs,
      processMs,
      compilerVersion: compiler.version,
      sourceCount: input.sourceCount,
      sourceBytes: input.sourceBytes,
      rawSourceBytes: input.rawSourceBytes,
      cacheHits: input.cacheHits,
      normalizedMetaAttributes: input.normalizedMetaAttributes,
      sourceTransform: input.sourceTransform,
      errorCount,
      warningCount,
      diagnosticMessages,
      command: [command, ...args],
      exitCode: result.exitCode,
      error:
        result.exitCode === 0
          ? undefined
          : (result.error ??
            `native compiler exited with code ${String(result.exitCode)}`),
    };
  } catch (error) {
    return {
      valid: false,
      totalMs: elapsed(totalStart),
      resolutionMs: input?.resolutionMs ?? null,
      normalizationMs: input?.normalizationMs ?? null,
      materializationMs,
      processMs,
      compilerVersion: compiler.version,
      sourceCount: input?.sourceCount ?? null,
      sourceBytes: input?.sourceBytes ?? null,
      rawSourceBytes: input?.rawSourceBytes ?? null,
      cacheHits: input?.cacheHits ?? null,
      normalizedMetaAttributes: input?.normalizedMetaAttributes ?? null,
      sourceTransform: input?.sourceTransform ?? null,
      diagnosticMessages: [],
      error: errorMessage(error),
    };
  } finally {
    await removeTemporaryDirectory(nativeDirectory);
  }
}

function statistics(samples, property) {
  const values = samples
    .map((sample) => sample[property])
    .filter((value) => typeof value === "number")
    .sort((left, right) => left - right);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) / 2
      : values[middle];
  return {
    median,
    min: values[0],
    max: values[values.length - 1],
  };
}

function summarizeSamples(samples, expectedSamples) {
  const successful = samples.filter((sample) => sample.valid);
  return {
    expectedSamples,
    successfulSamples: successful.length,
    valid: successful.length === expectedSamples,
    totalMs: statistics(successful, "totalMs"),
    resolutionMs: statistics(successful, "resolutionMs"),
    normalizationMs: statistics(successful, "normalizationMs"),
    setupMs: statistics(successful, "setupMs"),
    materializationMs: statistics(successful, "materializationMs"),
    operationMs: statistics(successful, "operationMs"),
    processMs: statistics(successful, "processMs"),
    failures: samples
      .filter((sample) => !sample.valid)
      .map((sample) => ({
        error: sample.error ?? "compiler returned an unsuccessful result",
        diagnostics: sample.diagnosticMessages ?? [],
      })),
    sampleMetadata: successful[0]
      ? {
          compilerVersion: successful[0].compilerVersion,
          sourceCount: successful[0].sourceCount,
          sourceBytes: successful[0].sourceBytes,
          rawSourceBytes: successful[0].rawSourceBytes,
          cacheHits: successful[0].cacheHits,
          normalizationMs: successful[0].normalizationMs,
          normalizedMetaAttributes: successful[0].normalizedMetaAttributes,
          sourceTransform: successful[0].sourceTransform,
          command: successful[0].command,
          exitCode: successful[0].exitCode,
          errorCount: successful[0].errorCount,
          warningCount: successful[0].warningCount,
          diagnosticMessages: successful[0].diagnosticMessages,
        }
      : null,
  };
}

async function createTemporaryDirectory(prefix) {
  return mkdtemp(join(tmpdir(), `ilic-wasm-benchmark-${prefix}-`));
}

async function removeTemporaryDirectory(directory) {
  if (directory) await rm(directory, { recursive: true, force: true });
}

async function runModelBenchmark({ model, compiler }) {
  const phases = { cold: {}, warm: {} };
  const errors = [];

  for (const operation of OPERATIONS) {
    let coldCacheDirectory;
    try {
      coldCacheDirectory =
        model.id === "so-nutzungsplanung"
          ? await createTemporaryDirectory(`${model.id}-cold`)
          : undefined;
      const sample = await measureSample({
        model,
        operation,
        compiler,
        cacheDirectory: coldCacheDirectory,
      });
      phases.cold[operation] = summarizeSamples([sample], 1);
      if (!sample.valid)
        errors.push({ phase: "cold", operation, details: sample });
    } finally {
      await removeTemporaryDirectory(coldCacheDirectory);
    }
  }

  let warmCacheDirectory;
  try {
    warmCacheDirectory =
      model.id === "so-nutzungsplanung"
        ? await createTemporaryDirectory(`${model.id}-warm`)
        : undefined;
    if (warmCacheDirectory) await model.prepare(warmCacheDirectory);

    for (const operation of OPERATIONS) {
      const warmup = await measureSample({
        model,
        operation,
        compiler,
        cacheDirectory: warmCacheDirectory,
      });
      if (!warmup.valid) {
        errors.push({ phase: "warmup", operation, details: warmup });
        phases.warm[operation] = summarizeSamples([], WARM_ITERATIONS);
        continue;
      }

      const samples = [];
      for (let index = 0; index < WARM_ITERATIONS; index++) {
        const sample = await measureSample({
          model,
          operation,
          compiler,
          cacheDirectory: warmCacheDirectory,
        });
        samples.push(sample);
        if (!sample.valid)
          errors.push({
            phase: "warm",
            operation,
            iteration: index + 1,
            details: sample,
          });
      }
      phases.warm[operation] = summarizeSamples(samples, WARM_ITERATIONS);
    }
  } finally {
    await removeTemporaryDirectory(warmCacheDirectory);
  }

  return { phases, valid: errors.length === 0, errors };
}

function unavailableNativeBenchmark(compiler) {
  const details = {
    valid: false,
    error: compiler.unavailableReason ?? "native compiler unavailable",
    diagnosticMessages: [],
  };
  return {
    phases: {
      cold: {
        [NATIVE_OPERATION]: summarizeSamples([], 1),
      },
      warm: {
        [NATIVE_OPERATION]: summarizeSamples([], WARM_ITERATIONS),
      },
    },
    valid: false,
    errors: [
      {
        phase: "unavailable",
        operation: NATIVE_OPERATION,
        details,
      },
    ],
  };
}

async function runNativeModelBenchmark({ model, compiler }) {
  if (!compiler.available) return unavailableNativeBenchmark(compiler);

  const phases = { cold: {}, warm: {} };
  const errors = [];
  let coldCacheDirectory;
  try {
    coldCacheDirectory =
      model.id === "so-nutzungsplanung"
        ? await createTemporaryDirectory(`${model.id}-${compiler.id}-cold`)
        : undefined;
    const sample = await measureNativeSample({
      model,
      compiler,
      cacheDirectory: coldCacheDirectory,
    });
    phases.cold[NATIVE_OPERATION] = summarizeSamples([sample], 1);
    if (!sample.valid)
      errors.push({
        phase: "cold",
        operation: NATIVE_OPERATION,
        details: sample,
      });
  } finally {
    await removeTemporaryDirectory(coldCacheDirectory);
  }

  let warmCacheDirectory;
  try {
    warmCacheDirectory =
      model.id === "so-nutzungsplanung"
        ? await createTemporaryDirectory(`${model.id}-${compiler.id}-warm`)
        : undefined;
    if (warmCacheDirectory) await model.prepare(warmCacheDirectory);

    const warmup = await measureNativeSample({
      model,
      compiler,
      cacheDirectory: warmCacheDirectory,
    });
    if (!warmup.valid) {
      errors.push({
        phase: "warmup",
        operation: NATIVE_OPERATION,
        details: warmup,
      });
      phases.warm[NATIVE_OPERATION] = summarizeSamples([], WARM_ITERATIONS);
    } else {
      const samples = [];
      for (let index = 0; index < WARM_ITERATIONS; index++) {
        const sample = await measureNativeSample({
          model,
          compiler,
          cacheDirectory: warmCacheDirectory,
        });
        samples.push(sample);
        if (!sample.valid)
          errors.push({
            phase: "warm",
            operation: NATIVE_OPERATION,
            iteration: index + 1,
            details: sample,
          });
      }
      phases.warm[NATIVE_OPERATION] = summarizeSamples(
        samples,
        WARM_ITERATIONS,
      );
    }
  } finally {
    await removeTemporaryDirectory(warmCacheDirectory);
  }

  return { phases, valid: errors.length === 0, errors };
}

function formatMilliseconds(value) {
  return value == null ? "-" : value.toFixed(2);
}

function printHumanReport(report) {
  console.log("Compiler-Benchmark für INTERLIS");
  console.log(`Zeitpunkt: ${report.generatedAt}`);
  console.log(
    `Umgebung: ${report.environment.node}, ${report.environment.platform}/${report.environment.arch}, ${report.environment.cpu}`,
  );
  console.log(
    `WASM-Load: ${formatMilliseconds(report.environment.compilerLoadMs)} ms, ABI ${report.environment.compilerAbiVersion}`,
  );
  for (const compiler of report.environment.nativeCompilers)
    console.log(
      `Native ${compiler.label}: ${compiler.version ?? "nicht verfügbar"}${compiler.path ? ` (${compiler.path})` : ""}`,
    );
  console.log("");

  const rows = [];
  for (const model of report.models) {
    const benchmark = report.results[model.id];
    for (const phase of ["cold", "warm"]) {
      for (const operation of OPERATIONS) {
        const result = benchmark.phases[phase][operation];
        rows.push({
          Compiler: "WASM",
          Modell: model.label,
          Phase: phase,
          Operation: operationLabel(operation),
          N: `${result.successfulSamples}/${result.expectedSamples}`,
          GesamtMedianMs: formatMilliseconds(result.totalMs?.median),
          AuflösungMedianMs: formatMilliseconds(result.resolutionMs?.median),
          KompatMedianMs: formatMilliseconds(result.normalizationMs?.median),
          SetupMedianMs: formatMilliseconds(result.setupMs?.median),
          WASMMedianMs: formatMilliseconds(result.operationMs?.median),
          MinMs: formatMilliseconds(result.operationMs?.min),
          MaxMs: formatMilliseconds(result.operationMs?.max),
          Status: result.valid ? "ok" : "UNGÜLTIG",
        });
      }
    }
  }
  console.table(rows);

  const nativeRows = [];
  for (const compiler of report.environment.nativeCompilers) {
    for (const model of report.models) {
      const benchmark = report.nativeResults[compiler.id][model.id];
      for (const phase of ["cold", "warm"]) {
        const result = benchmark.phases[phase][NATIVE_OPERATION];
        nativeRows.push({
          Compiler: compiler.label,
          Modell: model.label,
          Phase: phase,
          Operation: "Compile (CLI)",
          N: `${result.successfulSamples}/${result.expectedSamples}`,
          GesamtMedianMs: formatMilliseconds(result.totalMs?.median),
          AuflösungMedianMs: formatMilliseconds(result.resolutionMs?.median),
          VorbereitungMedianMs: formatMilliseconds(
            result.materializationMs?.median,
          ),
          "CLI+DateiMedianMs": formatMilliseconds(result.processMs?.median),
          MinMs: formatMilliseconds(result.processMs?.min),
          MaxMs: formatMilliseconds(result.processMs?.max),
          Status: result.valid ? "ok" : "UNGÜLTIG",
        });
      }
    }
  }
  console.log("");
  console.log("Native CLI (Compile; Prozessstart und Dateilesen enthalten):");
  console.table(nativeRows);

  console.log("");
  console.log("Eingaben:");
  for (const model of report.models) {
    const metadata =
      report.results[model.id].phases.warm.compileAndAnalyze.sampleMetadata;
    console.log(
      `- ${model.label}: ${metadata?.sourceCount ?? "?"} Quelle(n), ${metadata?.sourceBytes ?? "?"} Bytes (${metadata?.rawSourceBytes ?? "?"} roh), Compiler ${metadata?.compilerVersion ?? "?"}`,
    );
    if (metadata?.sourceTransform)
      console.log(`  Temporäre Quellenanpassung: ${metadata.sourceTransform}`);
    if (metadata?.normalizedMetaAttributes)
      console.log(
        `  Kompatibilitätsnormalisierung: ${metadata.normalizedMetaAttributes} Meta-Attribute in ${formatMilliseconds(metadata.normalizationMs)} ms`,
      );
    if (metadata?.warningCount)
      console.log(`  Compiler-Warnungen: ${metadata.warningCount}`);
    for (const message of metadata?.diagnosticMessages ?? [])
      console.log(`  Diagnostic: ${message}`);
  }

  if (report.errors.length) {
    console.log("");
    console.log("Fehlerhafte Messungen:");
    for (const failure of report.errors)
      console.log(
        `- ${failure.compiler ? `${failure.compiler} / ` : ""}${failure.model} / ${failure.phase} / ${failure.operation}: ${failure.details.error ?? failure.details.diagnosticMessages?.join("; ")}`,
      );
  }
}

function parseArguments() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help")) {
    console.log("Usage: pnpm benchmark:wasm [--json]");
    process.exit(0);
  }
  return { json: args.has("--json") };
}

async function main() {
  const options = parseArguments();
  const compilerLoadStart = now();
  const compiler = await createCompiler();
  const compilerLoadMs = elapsed(compilerLoadStart);
  const results = {};
  const nativeCompilers = getNativeCompilers();
  for (const nativeCompiler of nativeCompilers)
    nativeCompiler.version = await nativeCompilerVersion(nativeCompiler);
  const nativeResults = {};
  const errors = [];

  try {
    for (const model of models) {
      const benchmark = await runModelBenchmark({ model, compiler });
      results[model.id] = benchmark;
      for (const failure of benchmark.errors)
        errors.push({ model: model.label, ...failure });
    }

    for (const nativeCompiler of nativeCompilers) {
      nativeResults[nativeCompiler.id] = {};
      for (const model of models) {
        const benchmark = await runNativeModelBenchmark({
          model,
          compiler: nativeCompiler,
        });
        nativeResults[nativeCompiler.id][model.id] = benchmark;
        for (const failure of benchmark.errors)
          errors.push({
            compiler: nativeCompiler.label,
            model: model.label,
            ...failure,
          });
      }
    }
  } finally {
    // Sessions are disposed after each sample. Compiler owns the shared WASM module.
  }

  const report = {
    valid: errors.length === 0,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      osRelease: release(),
      cpu: cpus()[0]?.model ?? "unknown",
      compilerLoadMs,
      compilerAbiVersion: compiler.abiVersion,
      nativeCompilers: nativeCompilers.map((nativeCompiler) => ({
        id: nativeCompiler.id,
        label: nativeCompiler.label,
        path: nativeCompiler.path,
        version: nativeCompiler.version,
        available: nativeCompiler.available,
        unavailableReason: nativeCompiler.unavailableReason,
      })),
    },
    configuration: {
      warmIterations: WARM_ITERATIONS,
      repositories: REMOTE_REPOSITORIES,
      remoteRootUri: REMOTE_ROOT_URI,
      supplementalModels: REMOTE_SUPPLEMENTAL_MODELS,
      compatibilityNormalization:
        "insert a space after legacy !!@ metadata markers",
      localSourceTransform: "0..-9 -> -9..0 in a temporary benchmark copy",
      nativeOperation: NATIVE_OPERATION,
      nativeCli: {
        ilic: "-no_auto -quiet <dependency-first .ili files>",
        ili2c:
          "java -jar ili2c.jar --no-auto --quiet <dependency-first .ili files>",
      },
      nativeSourceOrder: REMOTE_NATIVE_SOURCE_ORDER,
      operations: OPERATIONS,
    },
    models: models.map((model) => ({ id: model.id, label: model.label })),
    results,
    nativeResults,
    errors,
  };

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);
  if (!report.valid) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(
    `Benchmark konnte nicht ausgeführt werden: ${errorMessage(error)}`,
  );
  process.exitCode = 1;
}
