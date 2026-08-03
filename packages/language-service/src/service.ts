import { LanguageServiceRuntime } from "./language-service-runtime.js";

/** Public API facade. Lifecycle and cross-component coordination live in the runtime. */
export class LanguageService extends LanguageServiceRuntime {}
