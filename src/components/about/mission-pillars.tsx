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
      <div className="page-gutter mx-auto max-w-6xl">
        <h2 className="type-page-title text-balance">{heading}</h2>
        <div className="mt-8 space-y-6">
          <p className="type-section text-balance">{statement}</p>
          <p className="type-body text-pretty">{context}</p>
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
      </div>
    </section>
  );
}
