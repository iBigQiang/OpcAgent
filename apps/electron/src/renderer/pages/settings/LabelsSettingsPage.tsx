/**
 * LabelsSettingsPage
 *
 * Displays workspace label configuration in two data tables:
 * 1. Label Hierarchy - tree table with expand/collapse showing all labels
 * 2. Auto-Apply Rules - flat table showing all regex rules across labels
 *
 * Each section has an Edit button that opens an EditPopover for AI-assisted editing
 * of the underlying labels/config.json file.
 *
 * Data is loaded via the useLabels hook which subscribes to live config changes.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getDocUrl } from '@mkagent/shared/docs/doc-links'
import { ChevronDown, ChevronUp, Loader2, Pencil, Trash2 } from 'lucide-react'
import { useAppShellContext } from '@/context/AppShellContext'
import { useLabels } from '@/hooks/useLabels'
import { getDescendantIds } from '@mkagent/shared/labels'
import type { LabelConfig } from '@mkagent/shared/labels'
import {
  LabelsDataTable,
} from '@/components/info'
import {
  SettingsSection,
  SettingsCard,
} from '@/components/settings'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'labels',
}

export default function LabelsSettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const { labels, isLoading, create: createLabel, update, remove: removeLabel, move, reorder } = useLabels(activeWorkspaceId)
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null)
  const [moving, setMoving] = React.useState<string | null>(null)
  const rows = React.useMemo(() => flattenLabelRows(labels), [labels])
  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try { await createLabel({ name: name.trim() }); setName('') } finally { setBusy(false) }
  }
  const remove = async (labelId: string) => {
    setBusy(true)
    try { await removeLabel(labelId); if (editing?.id === labelId) setEditing(null) } finally { setBusy(false) }
  }
  const rename = async () => {
    if (!editing || !editing.name.trim()) return
    setBusy(true)
    try { await update(editing.id, { name: editing.name.trim() }); setEditing(null) } finally { setBusy(false) }
  }
  const changeParent = async (labelId: string, parentId: string | null) => {
    setBusy(true)
    try { await move(labelId, parentId); setMoving(null) } finally { setBusy(false) }
  }
  const moveSibling = async (row: LabelRow, direction: -1 | 1) => {
    const siblings = rows.filter(candidate => candidate.parentId === row.parentId)
    const index = siblings.findIndex(candidate => candidate.label.id === row.label.id)
    const replacement = siblings[index + direction]
    if (!replacement) return
    const orderedIds = siblings.map(candidate => candidate.label.id)
    ;[orderedIds[index], orderedIds[index + direction]] = [orderedIds[index + direction], orderedIds[index]]
    setBusy(true)
    try { await reorder(row.parentId, orderedIds) } finally { setBusy(false) }
  }

  return (
    <div className="h-full flex flex-col">
    <PanelHeader title={t("settings.labels.title")} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* About Section */}
                  <SettingsSection title={t("settings.labels.aboutLabels")}>
                    <SettingsCard className="px-4 py-3.5">
                      <div className="text-sm text-muted-foreground leading-relaxed space-y-1.5">
                        <p>
                          {t("settings.labels.aboutText1")}
                        </p>
                        <p>
                          {t("settings.labels.aboutText2")}
                        </p>
                        <p>
                          {t("settings.labels.aboutText3")}
                        </p>
                        <p>
                          <button
                            type="button"
                            onClick={() => window.electronAPI?.openUrl(getDocUrl('sources'))}
                            className="text-foreground/70 hover:text-foreground underline underline-offset-2"
                          >
                            {t("chat.learnMore")}
                          </button>
                        </p>
                      </div>
                    </SettingsCard>
                  </SettingsSection>

                  {/* Label Hierarchy Section */}
                  <SettingsSection
                    title={t("settings.labels.labelHierarchy")}
                    description={t("settings.labels.labelHierarchyDesc")}
                  >
                    <SettingsCard className="p-0">
                      {labels.length > 0 ? (
                        <LabelsDataTable
                          data={labels}
                          searchable
                          maxHeight={350}
                          fullscreen
                          fullscreenTitle={t("settings.labels.labelHierarchy")}
                        />
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">
                          <p className="text-sm">{t("settings.labels.noLabels")}</p>
                          <p className="text-xs mt-1 text-foreground/40">
                            {t("settings.labels.noLabelsDesc")}
                          </p>
                        </div>
                      )}
                    </SettingsCard>
                    <SettingsCard className="mt-3 p-3" divided={false}>
                      <div className="flex gap-2"><Input value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void create() }} placeholder={t('common.name')} disabled={busy} /><Button disabled={busy || !name.trim()} onClick={() => void create()}>{t('common.create')}</Button></div>
                      {rows.length > 0 && <div className="mt-3 space-y-1">{rows.map((row) => {
                        const isEditing = editing?.id === row.label.id
                        const siblings = rows.filter(candidate => candidate.parentId === row.parentId)
                        const siblingIndex = siblings.findIndex(candidate => candidate.label.id === row.label.id)
                        const excludedParents = new Set([row.label.id, ...getDescendantIds(labels, row.label.id)])
                        return <div key={row.label.id} className="flex min-w-0 items-center gap-1.5 text-sm" style={{ paddingLeft: `${row.depth * 16}px` }}>
                          {isEditing ? <><Input value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} disabled={busy} /><Button size="sm" disabled={busy || !editing.name.trim()} onClick={() => void rename()}>Save</Button><Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button></> : <><span className="min-w-0 flex-1 truncate">{row.label.name}</span><Button variant="ghost" size="sm" aria-label={`Rename ${row.label.name}`} disabled={busy} onClick={() => setEditing({ id: row.label.id, name: row.label.name })}><Pencil className="h-3.5 w-3.5" /></Button></>}
                          {!isEditing && <><Button variant="ghost" size="sm" aria-label={`Move ${row.label.name} up`} disabled={busy || siblingIndex === 0} onClick={() => void moveSibling(row, -1)}><ChevronUp className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" aria-label={`Move ${row.label.name} down`} disabled={busy || siblingIndex === siblings.length - 1} onClick={() => void moveSibling(row, 1)}><ChevronDown className="h-3.5 w-3.5" /></Button><select aria-label={`Parent for ${row.label.name}`} value={moving === row.label.id ? row.parentId ?? '' : ''} disabled={busy} onChange={event => { if (event.target.value !== '') void changeParent(row.label.id, event.target.value === '__root__' ? null : event.target.value); else setMoving(row.label.id) }} className="h-8 max-w-28 rounded-md border bg-background px-1 text-xs"><option value="">Move…</option><option value="__root__">Root</option>{rows.filter(candidate => !excludedParents.has(candidate.label.id)).map(candidate => <option key={candidate.label.id} value={candidate.label.id}>{candidate.label.name}</option>)}</select><Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(row.label.id)}><Trash2 className="h-3.5 w-3.5" /></Button></>}
                        </div>
                      })}</div>}
                    </SettingsCard>
                  </SettingsSection>

                  {/* Auto-Apply Rules Section */}
                  <SettingsSection
                    title={t("settings.labels.autoApplyRules")}
                    description={t("settings.labels.autoApplyRulesDesc")}
                  >
                    <SettingsCard className="p-0">
                      <LabelsDataTable data={labels} searchable maxHeight={350} fullscreen fullscreenTitle={t("settings.labels.autoApplyRules")} />
                    </SettingsCard>
                  </SettingsSection>
                </>
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

interface LabelRow {
  label: LabelConfig
  parentId: string | null
  depth: number
}

function flattenLabelRows(labels: LabelConfig[], parentId: string | null = null, depth = 0): LabelRow[] {
  return labels.flatMap(label => [
    { label, parentId, depth },
    ...flattenLabelRows(label.children ?? [], label.id, depth + 1),
  ])
}
