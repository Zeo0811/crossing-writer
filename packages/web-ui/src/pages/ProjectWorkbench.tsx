import { useParams } from "react-router-dom";

export function ProjectWorkbench() {
  const { id } = useParams();
  return <div className="p-6">Workbench for {id} (stub)</div>;
}
