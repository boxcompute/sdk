import { readFile, writeFile } from "node:fs/promises";

const output = new URL("../openapi/boxcompute-v2.json", import.meta.url);
const source = process.env.BOXCOMPUTE_OPENAPI_SOURCE ??
  "https://api.boxcompute.ai/api/v2/openapi.json";

let text;
if (/^https?:\/\//u.test(source)) {
  const response = await fetch(source, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download OpenAPI contract (${response.status})`);
  }
  text = await response.text();
} else {
  text = await readFile(source, "utf8");
}

const contract = JSON.parse(text);
if (contract.openapi !== "3.1.0") throw new Error("Expected OpenAPI 3.1.0");
if (contract.info?.title !== "BoxCompute Customer Sandbox API") {
  throw new Error("Refusing a non-customer BoxCompute contract");
}
const paths = Object.keys(contract.paths ?? {});
if (paths.length === 0 || paths.some((path) => !path.startsWith("/api/v2/"))) {
  throw new Error("Contract contains no v2 routes or includes a non-v2 route");
}

await writeFile(output, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
console.log(`Updated ${output.pathname} from ${source}`);
