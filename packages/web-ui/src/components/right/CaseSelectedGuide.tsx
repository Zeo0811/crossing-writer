import { useEffect, useState } from "react";
import { getSelectedCases } from "../../api/client";

export function CaseSelectedGuide({ projectId }: { projectId: string }) {
  const [md, setMd] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getSelectedCases(projectId).then(setMd);
  }, [projectId]);

  if (md === undefined) return <div>加载中...</div>;

  return (
    <div className="p-4">
      <div className="bg-green-50 border border-green-300 p-3 rounded">
        <h3 className="font-semibold">Case Plan 已批准 ✅</h3>
        <p className="text-sm">下一步：<strong>去跑真实测</strong></p>
      </div>
      <pre className="whitespace-pre-wrap mt-4 text-xs">{md}</pre>
      <button disabled
        className="mt-4 bg-gray-300 text-gray-600 px-3 py-1"
        title="SP-04 未上线">
        Evidence 上传（SP-04 未上线）
      </button>
    </div>
  );
}
