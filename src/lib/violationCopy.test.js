import { objectNameKey } from "./violationCopy";

describe("objectNameKey", () => {
  it("maps detector labels to camelCase copy keys", () => {
    expect(objectNameKey("cell phone")).toBe("violations.objects.cellPhone");
    expect(objectNameKey("Cell_Phone")).toBe("violations.objects.cellPhone");
    expect(objectNameKey("laptop")).toBe("violations.objects.laptop");
  });

  it("falls back to a generic name when there is no label", () => {
    expect(objectNameKey(undefined)).toBe("violations.objects.unknown");
  });
});
