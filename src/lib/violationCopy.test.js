import { objectNameKey, violationCopy } from "./violationCopy";

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

describe("violationCopy", () => {
  it("returns dedicated mobile artwork and copy for cell phone", () => {
    const byKey = violationCopy("PROHIBITED_OBJECT:cell phone");
    expect(byKey).toEqual({
      titleKey: "violations.cellPhone.title",
      descriptionKey: "violations.cellPhone.description",
      imagePath: "/cell-phone.svg",
    });

    const byArgs = violationCopy("PROHIBITED_OBJECT", "cell phone");
    expect(byArgs).toEqual(byKey);

    // Case-insensitive label handling
    const byMixedArgs = violationCopy("PROHIBITED_OBJECT", "Cell Phone");
    expect(byMixedArgs).toEqual(byKey);

    const byMixedKey = violationCopy("prohibited_object:cell phone");
    expect(byMixedKey).toEqual(byKey);
  });

  it("falls back to default prohibited object copy for other devices", () => {
    const copy = violationCopy("PROHIBITED_OBJECT");
    expect(copy.imagePath).toBe("/laptop.png");
    expect(copy.titleKey).toBe("violations.prohibitedObject.title");
  });

  it("provides soft guidance copy for no-face soft warning", () => {
    const copy = violationCopy("NO_FACE_GUIDANCE");
    expect(copy).toMatchObject({
      titleKey: "violations.noFaceGuidance.title",
      descriptionKey: "violations.noFaceGuidance.description",
      soft: true,
    });
  });

  it("returns null for unknown violation types", () => {
    expect(violationCopy("UNKNOWN_TYPE")).toBeNull();
  });
});
