import { getVoiceLabel } from "@/components/VoiceIdSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AgentPresetCategory,
  type AgentPresetKind,
  type AgentPresetTemplate,
  listAgentPresets,
} from "@/lib/agent-presets";
import {
  Briefcase,
  Laugh,
  Loader2,
  PhoneIncoming,
  PhoneOutgoing,
  Search,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

interface AgentPresetGalleryProps {
  kind?: AgentPresetKind | "all";
  title?: string;
  description?: string;
  actionLabel?: string;
  busyTemplateId?: string | null;
  onUseTemplate: (template: AgentPresetTemplate) => void | Promise<void>;
  dataOcidPrefix?: string;
}

export function AgentPresetGallery({
  kind = "all",
  title = "Ready-made agents",
  description = "Add a professional or playful agent in one click. Templates become your editable presets.",
  actionLabel = "Add preset",
  busyTemplateId = null,
  onUseTemplate,
  dataOcidPrefix = "agent_gallery",
}: AgentPresetGalleryProps) {
  const [category, setCategory] = useState<AgentPresetCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const templates = useMemo(
    () => listAgentPresets({ kind, category, search }),
    [kind, category, search],
  );

  const professionalCount = useMemo(
    () => listAgentPresets({ kind, category: "professional" }).length,
    [kind],
  );
  const funCount = useMemo(
    () => listAgentPresets({ kind, category: "fun" }).length,
    [kind],
  );

  return (
    <Card
      className="bg-card border-border"
      data-ocid={`${dataOcidPrefix}.card`}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {title}
            </CardTitle>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-[10px] h-5 gap-1">
              <Briefcase className="w-3 h-3" />
              {professionalCount} pro
            </Badge>
            <Badge variant="outline" className="text-[10px] h-5 gap-1">
              <Laugh className="w-3 h-3" />
              {funCount} fun
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search agents, tags, or roles"
              className="pl-9 h-9 text-sm"
              data-ocid={`${dataOcidPrefix}.search`}
            />
          </div>
          <Select
            value={category}
            onValueChange={(value) =>
              setCategory(value as AgentPresetCategory | "all")
            }
          >
            <SelectTrigger
              className="h-9 w-full sm:w-[160px]"
              data-ocid={`${dataOcidPrefix}.category_select`}
            >
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All styles</SelectItem>
              <SelectItem value="professional">Professional</SelectItem>
              <SelectItem value="fun">Fun & prank</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {templates.length === 0 ? (
          <div
            className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground"
            data-ocid={`${dataOcidPrefix}.empty`}
          >
            No agents match that filter.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map((template) => {
              const isBusy = busyTemplateId === template.id;
              const isExpanded = expandedId === template.id;
              return (
                <div
                  key={template.id}
                  className="rounded-lg border border-border bg-muted/15 p-3 space-y-2.5"
                  data-ocid={`${dataOcidPrefix}.item.${template.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-foreground">
                          {template.name}
                        </p>
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-4 px-1 ${
                            template.category === "fun"
                              ? "border-amber-500/40 text-amber-300"
                              : "border-primary/30 text-primary"
                          }`}
                        >
                          {template.category === "fun" ? "Fun" : "Pro"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                        {template.description}
                      </p>
                    </div>
                    {template.kind === "inbound" ? (
                      <PhoneIncoming className="w-4 h-4 text-muted-foreground shrink-0" />
                    ) : (
                      <PhoneOutgoing className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[10px] h-4 px-1">
                      {getVoiceLabel(template.voice, template.voiceId)}
                    </Badge>
                    {template.toolsEnabled.webSearch && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        Web search
                      </Badge>
                    )}
                    {template.toolsEnabled.xSearch && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        X search
                      </Badge>
                    )}
                    {template.tags.slice(0, 2).map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-[10px] h-4 px-1 text-muted-foreground"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  {isExpanded && (
                    <p
                      className="text-[11px] leading-relaxed text-muted-foreground rounded-md border border-border bg-background/50 p-2 max-h-28 overflow-y-auto font-mono"
                      data-ocid={`${dataOcidPrefix}.preview.${template.id}`}
                    >
                      {template.systemPrompt.slice(0, 420)}
                      {template.systemPrompt.length > 420 ? "…" : ""}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs gap-1.5"
                      disabled={Boolean(busyTemplateId)}
                      onClick={() => void onUseTemplate(template)}
                      data-ocid={`${dataOcidPrefix}.use.${template.id}`}
                    >
                      {isBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      {isBusy ? "Adding…" : actionLabel}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() =>
                        setExpandedId((current) =>
                          current === template.id ? null : template.id,
                        )
                      }
                      data-ocid={`${dataOcidPrefix}.toggle_preview.${template.id}`}
                    >
                      {isExpanded ? "Hide preview" : "Preview"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
