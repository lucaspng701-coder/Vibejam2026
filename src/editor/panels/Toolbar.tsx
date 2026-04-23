import { useRef } from 'react'
import type { GizmoMode } from '../state/store'
import { useEditorStore } from '../state/store'
import type { LevelFile } from '../../level/types'

export function Toolbar() {
    const levelName = useEditorStore((s) => s.levelName)
    const setLevelName = useEditorStore((s) => s.setLevelName)
    const mode = useEditorStore((s) => s.mode)
    const setMode = useEditorStore((s) => s.setMode)
    const showColliders = useEditorStore((s) => s.showColliders)
    const toggleColliders = useEditorStore((s) => s.toggleColliders)
    const showGrid = useEditorStore((s) => s.showGrid)
    const toggleGrid = useEditorStore((s) => s.toggleGrid)
    const previewLighting = useEditorStore((s) => s.previewLighting)
    const togglePreviewLighting = useEditorStore((s) => s.togglePreviewLighting)
    const undo = useEditorStore((s) => s.undo)
    const redo = useEditorStore((s) => s.redo)
    const canUndo = useEditorStore((s) => s.past.length > 0)
    const canRedo = useEditorStore((s) => s.future.length > 0)

    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleSave = () => {
        const data = useEditorStore.getState().toLevelFile()
        const json = JSON.stringify(data, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${data.name || 'level'}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    const handleLoadClick = () => fileInputRef.current?.click()

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        try {
            const text = await file.text()
            const level = JSON.parse(text) as LevelFile
            if (level.version !== 1 || !Array.isArray(level.instances)) {
                alert('Arquivo inválido: esperado LevelFile v1')
                return
            }
            useEditorStore.getState().loadLevel(level)
        } catch (err) {
            console.error(err)
            alert(`Falha ao ler JSON: ${String(err)}`)
        } finally {
            e.target.value = ''
        }
    }

    return (
        <div className="h-12 flex items-center gap-2 px-3 border-b border-neutral-800 bg-neutral-950 text-neutral-200 text-sm">
            <a
                href="/"
                className="text-xs text-neutral-400 hover:text-neutral-200 px-2 py-1 rounded border border-neutral-800"
                title="Voltar ao jogo"
            >
                ← Game
            </a>

            <div className="h-6 w-px bg-neutral-800" />

            <label className="text-xs text-neutral-500">Level</label>
            <input
                type="text"
                value={levelName}
                onChange={(e) => setLevelName(e.target.value)}
                className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-xs w-40"
            />

            <div className="h-6 w-px bg-neutral-800 mx-1" />

            <ModeButton label="Translate (E)" active={mode === 'translate'} onClick={() => setMode('translate')} />
            <ModeButton label="Rotate (R)" active={mode === 'rotate'} onClick={() => setMode('rotate')} />
            <ModeButton label="Scale (S)" active={mode === 'scale'} onClick={() => setMode('scale')} />

            <div className="h-6 w-px bg-neutral-800 mx-1" />

            <ToggleButton label="Grid" active={showGrid} onClick={toggleGrid} />
            <ToggleButton label="Colliders" active={showColliders} onClick={toggleColliders} />
            <ToggleButton
                label="Preview Lighting"
                active={previewLighting}
                onClick={togglePreviewLighting}
            />

            <div className="h-6 w-px bg-neutral-800 mx-1" />

            <button
                disabled={!canUndo}
                onClick={undo}
                className="text-xs px-2 py-1 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-40"
                title="Undo (Ctrl+Z)"
            >
                ↶ Undo
            </button>
            <button
                disabled={!canRedo}
                onClick={redo}
                className="text-xs px-2 py-1 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 disabled:opacity-40"
                title="Redo (Ctrl+Shift+Z)"
            >
                ↷ Redo
            </button>

            <div className="flex-1" />

            <button
                onClick={handleLoadClick}
                className="text-xs px-3 py-1 rounded bg-neutral-900 hover:bg-neutral-800 border border-neutral-800"
            >
                Load…
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFile}
                className="hidden"
            />
            <button
                onClick={handleSave}
                className="text-xs px-3 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-white"
            >
                Save JSON
            </button>
        </div>
    )
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`text-xs px-2 py-1 rounded border ${
                active ? 'bg-blue-900/60 border-blue-700 text-blue-100' : 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800'
            }`}
        >
            {label}
        </button>
    )
}

function ToggleButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`text-xs px-2 py-1 rounded border ${
                active ? 'bg-neutral-700 border-neutral-600 text-white' : 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800'
            }`}
        >
            {label}
        </button>
    )
}

export type { GizmoMode }
