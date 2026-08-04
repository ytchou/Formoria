import { getAuditContext } from "@/lib/audit/__spike__/correlation-probe";
import { __rawRequestScope } from "@/lib/audit/__spike__/correlation-probe";

export async function GET() {
  const first = getAuditContext();
  await Promise.resolve();
  const second = getAuditContext();
  const rawA = __rawRequestScope();
  await Promise.resolve();
  const rawB = __rawRequestScope();

  return Response.json({
    first,
    second,
    rawA,
    rawB,
    rawSameRef: rawA === rawB,
    rawSameId: rawA.correlationId === rawB.correlationId,
  });
}
