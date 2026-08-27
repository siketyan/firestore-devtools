import { describe, expect, it } from "vitest";

import {
  decodeDocument,
  decodeValue,
  relativePath,
} from "../../src/shared/proto";

describe("decodeValue", () => {
  it("unwraps the scalars", () => {
    expect(decodeValue({ stringValue: "hi" })).toBe("hi");
    expect(decodeValue({ booleanValue: false })).toBe(false);
    expect(decodeValue({ doubleValue: 1.5 })).toBe(1.5);
    expect(decodeValue({ nullValue: null })).toBeNull();
    expect(decodeValue({ timestampValue: "2026-08-27T00:00:00Z" })).toBe(
      "2026-08-27T00:00:00Z",
    );
  });

  it("reads an integer back as a number while that is lossless", () => {
    expect(decodeValue({ integerValue: "18" })).toBe(18);
  });

  it("leaves an integer too large for a double as it arrived", () => {
    // Firestore's int64 goes further than Number can represent exactly.
    expect(decodeValue({ integerValue: "9007199254740993" })).toBe(
      "9007199254740993",
    );
  });

  it("shortens a reference the way the rest of the panel does", () => {
    expect(
      decodeValue({
        referenceValue: "projects/demo/databases/(default)/documents/users/u1",
      }),
    ).toBe("users/u1");
  });

  it("recurses through arrays and maps", () => {
    expect(
      decodeValue({
        arrayValue: {
          values: [{ stringValue: "a" }, { integerValue: "2" }],
        },
      }),
    ).toEqual(["a", 2]);

    expect(
      decodeValue({
        mapValue: {
          fields: {
            nested: { arrayValue: { values: [{ booleanValue: true }] } },
          },
        },
      }),
    ).toEqual({ nested: [true] });
  });

  it("hands back a shape it does not recognise", () => {
    expect(decodeValue({ somethingNew: 1 })).toEqual({ somethingNew: 1 });
    expect(decodeValue("already plain")).toBe("already plain");
    expect(decodeValue(undefined)).toBeUndefined();
  });

  it("treats an empty map as an empty object rather than as nothing", () => {
    expect(decodeValue({ mapValue: {} })).toEqual({});
    expect(decodeValue({ arrayValue: {} })).toEqual([]);
  });
});

describe("decodeDocument", () => {
  it("unwraps the fields and leaves the metadata alone", () => {
    expect(
      decodeDocument({
        name: "projects/demo/databases/(default)/documents/messages/m1",
        fields: { body: { stringValue: "hi" }, read: { booleanValue: false } },
        createTime: "2026-08-27T12:59:00Z",
      }),
    ).toEqual({
      name: "projects/demo/databases/(default)/documents/messages/m1",
      fields: { body: "hi", read: false },
      createTime: "2026-08-27T12:59:00Z",
    });
  });

  it("leaves something that is not a document alone", () => {
    expect(decodeDocument({ name: "x" })).toEqual({ name: "x" });
    expect(decodeDocument("nope")).toBe("nope");
  });
});

describe("relativePath", () => {
  it("strips the database prefix", () => {
    expect(
      relativePath("projects/demo/databases/(default)/documents/users/u1"),
    ).toBe("users/u1");
  });

  it("leaves a path that has none", () => {
    expect(relativePath("users/u1")).toBe("users/u1");
  });
});
