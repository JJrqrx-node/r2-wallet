// Empty stub used to replace heavy dependencies we never call at runtime.
// The R-Squared SDK eagerly imports aws-sdk's S3 client for an S3Adapter
// the wallet never touches. This stub returns a class that throws if
// anyone accidentally tries to instantiate it, so missing-feature bugs
// fail loudly instead of silently breaking the bundle at load.
class UnavailableStub {
  constructor() {
    throw new Error(
      "[r2-wallet] This SDK feature (S3 storage) is intentionally disabled in the extension build."
    );
  }
}
export default UnavailableStub;
export { UnavailableStub };
