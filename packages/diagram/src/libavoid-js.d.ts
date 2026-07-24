declare module "libavoid-js" {
  interface NativeObject {
    delete(): void;
  }

  interface EnumValue {
    readonly value: number;
  }

  interface AvoidPoint extends NativeObject {
    readonly x: number;
    readonly y: number;
  }

  interface AvoidPolyline extends NativeObject {
    size(): number;
    at(index: number): AvoidPoint;
  }

  interface AvoidRectangle extends NativeObject {}
  interface AvoidShapeRef extends NativeObject {}
  interface AvoidConnEnd extends NativeObject {}

  interface AvoidConnRef extends NativeObject {
    displayRoute(): AvoidPolyline;
    setRoutingType(type: EnumValue): void;
    setHateCrossings(value: boolean): void;
  }

  interface AvoidRouter extends NativeObject {
    processTransaction(): boolean;
    deleteConnector(connector: AvoidConnRef): void;
    deleteShape(shape: AvoidShapeRef): void;
    setRoutingParameter(parameter: EnumValue, value: number): void;
    setRoutingOption(option: EnumValue, value: boolean): void;
  }

  export interface Avoid {
    readonly RouterFlag: {
      readonly PolyLineRouting: EnumValue;
      readonly OrthogonalRouting: EnumValue;
    };
    readonly ConnType: {
      readonly ConnType_PolyLine: EnumValue;
      readonly ConnType_Orthogonal: EnumValue;
    };
    readonly RoutingParameter: {
      readonly crossingPenalty: EnumValue;
      readonly shapeBufferDistance: EnumValue;
      readonly idealNudgingDistance: EnumValue;
    };
    readonly RoutingOption: {
      readonly nudgeOrthogonalSegmentsConnectedToShapes: EnumValue;
      readonly nudgeOrthogonalTouchingColinearSegments: EnumValue;
      readonly nudgeSharedPathsWithCommonEndPoint: EnumValue;
    };
    readonly Point: new (x: number, y: number) => AvoidPoint;
    readonly Rectangle: new (
      topLeft: AvoidPoint,
      bottomRight: AvoidPoint,
    ) => AvoidRectangle;
    readonly ShapeRef: new (
      router: AvoidRouter,
      rectangle: AvoidRectangle,
      id?: number,
    ) => AvoidShapeRef;
    readonly ConnEnd: new (point: AvoidPoint) => AvoidConnEnd;
    readonly ConnRef: new (
      router: AvoidRouter,
      source: AvoidConnEnd,
      target: AvoidConnEnd,
      id?: number,
    ) => AvoidConnRef;
    readonly Router: new (flags: number) => AvoidRouter;
  }

  export namespace AvoidLib {
    function load(wasmPath?: string): Promise<void>;
    function getInstance(): Avoid;
  }
}
