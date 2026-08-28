import { openApiDocument } from "@/contracts/openapi";
import { apiJson } from "@/server/public-api";

export async function GET(req: Request) {
  return apiJson(req, openApiDocument);
}
