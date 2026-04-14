import { useState } from "react";
import { TopicExpertConsultModal } from "./TopicExpertConsultModal";

interface Props {
  projectId: string;
  briefSummary?: string;
  productContext?: string;
  candidatesMd?: string;
  currentDraft?: string;
  onSaveNote?: (relPath: string, markdown: string) => void | Promise<void>;
}

export function TopicExpertSummonButton(props: Props) {
  const [open, setOpen] = useState(false);
  const disabled = !props.briefSummary;
  return (
    <>
      <button
        data-testid="topic-expert-summon-btn"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        🗂 召唤选题专家团
      </button>
      <TopicExpertConsultModal
        projectId={props.projectId}
        briefSummary={props.briefSummary}
        productContext={props.productContext}
        candidatesMd={props.candidatesMd}
        currentDraft={props.currentDraft}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={async (md) => {
          await props.onSaveNote?.("topic-expert-panel.md", md);
          setOpen(false);
        }}
      />
    </>
  );
}
