import { useState } from "react";

interface Props {
  onClose: () => void;
  onSubmit: (body: { name: string; specialty: string; seed_urls?: string[] }) => void | Promise<void>;
}

export function NewTopicExpertModal({ onClose, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [seeds, setSeeds] = useState("");

  const submit = () => {
    const urls = seeds.split(/\n/).map((s) => s.trim()).filter(Boolean);
    onSubmit({ name, specialty, seed_urls: urls.length ? urls : undefined });
  };

  return (
    <div role="dialog" aria-label="新增专家" data-testid="te-new-modal">
      <label>
        名称
        <input
          aria-label="new-te-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        专长
        <input
          aria-label="new-te-specialty"
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
        />
      </label>
      <label>
        种子 URLs (每行一个)
        <textarea
          aria-label="new-te-seeds"
          value={seeds}
          onChange={(e) => setSeeds(e.target.value)}
        />
      </label>
      <button onClick={onClose}>取消</button>
      <button onClick={submit} data-testid="te-new-submit">提交</button>
    </div>
  );
}
