import Link from "next/link";
import type { Teacher } from "@/types";
import { Badge } from "@/components/ui/Badge";

interface TeacherCardProps {
  teacher: Teacher;
}

export function TeacherCard({ teacher }: TeacherCardProps) {
  return (
    <Link
      href={`/admin/teachers/${teacher.id}`}
      className="block rounded-lg border border-border bg-surface p-4 hover:border-muted transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-text">{teacher.name}</div>
          <div className="mt-0.5 text-sm text-muted">
            {teacher.language}
            {teacher.nationality ? ` · ${teacher.nationality}` : ""}
            {teacher.age ? ` · ${teacher.age}` : ""}
          </div>
        </div>
        <Badge tone={teacher.is_active ? "success" : "neutral"}>
          {teacher.is_active ? "active" : "inactive"}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-muted">WhatsApp</div>
          <div className="font-mono text-text">
            {teacher.whatsapp_number ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-muted">Voice</div>
          <div className="font-mono text-text truncate">
            {teacher.elevenlabs_voice_id ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-muted">Agent ID</div>
          <div className="font-mono text-text truncate">
            {teacher.elevenlabs_agent_id ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-muted">Gender</div>
          <div className="text-text">{teacher.gender ?? "—"}</div>
        </div>
      </div>
    </Link>
  );
}
