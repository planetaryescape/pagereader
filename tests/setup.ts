import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { __resetImportsMock } from "./mocks/imports";

afterEach(() => {
  cleanup();
  __resetImportsMock();
});
