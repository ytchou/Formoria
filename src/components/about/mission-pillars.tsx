import { PageShell } from "@/components/ui/page-shell";

import {
  AboutCard,
  AboutCardContent,
  AboutCardGrid,
} from "./about-card-grid";

interface Pillar {
  heading: string;
  body: string;
}

interface MissionPillarsProps {
  heading: string;
  statement: string;
  context: string;
  pillars: [Pillar, Pillar, Pillar];
}

export default function MissionPillars({
  heading,
  statement,
  context,
  pillars,
}: MissionPillarsProps) {
  return (
    <section className="py-section">
      <PageShell measure="page">
        <h2 className="type-page-title text-balance">{heading}</h2>
        <div className="mt-8 space-y-6">
          <p className="prose-measure type-section text-balance">{statement}</p>
          <p className="prose-measure type-body text-pretty">{context}</p>
        </div>
        <AboutCardGrid>
          {pillars.map((pillar, index) => (
            <AboutCard key={pillar.heading}>
              <AboutCardContent
                eyebrow={String(index + 1).padStart(2, "0")}
                heading={pillar.heading}
                body={pillar.body}
              />
            </AboutCard>
          ))}
        </AboutCardGrid>
      </PageShell>
    </section>
  );
}
