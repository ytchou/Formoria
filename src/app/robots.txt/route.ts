import { withAuditScope } from "@/lib/audit";
import { getSiteUrl } from "@/lib/seo/site-url";
import { buildRobotsDocument, formatRobotsTxt } from "./robots-content";

export const revalidate = 3600;

export const GET = withAuditScope(async () => {
  const body = formatRobotsTxt(buildRobotsDocument(getSiteUrl()));

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});
