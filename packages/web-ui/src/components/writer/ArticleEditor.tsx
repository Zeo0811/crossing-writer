import { ArticleFlow } from './ArticleFlow.js';

export interface ArticleEditorProps {
  projectId: string;
}

export function ArticleEditor({ projectId }: ArticleEditorProps) {
  return <ArticleFlow projectId={projectId} />;
}
