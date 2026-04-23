import { useEffect } from 'react'
import { EditorScene } from './scene/EditorScene'
import { AssetLibraryPanel } from './panels/AssetLibraryPanel'
import { InspectorPanel } from './panels/InspectorPanel'
import { OutlinerPanel } from './panels/OutlinerPanel'
import { Toolbar } from './panels/Toolbar'
import { useEditorStore } from './state/store'

export default function Editor() {
    useEditorShortcuts()

    return (
        <div className="fixed inset-0 flex flex-col bg-neutral-950 text-neutral-200">
            <Toolbar />
            <div className="flex-1 flex min-h-0">
                <aside className="w-60 border-r border-neutral-800 bg-neutral-900 shrink-0">
                    <OutlinerPanel />
                </aside>
                <div className="flex-1 flex flex-col min-w-0">
                    <main className="flex-1 relative min-h-0">
                        <EditorScene />
                        <HintsOverlay />
                    </main>
                    <section className="h-44 border-t border-neutral-800 bg-neutral-900 shrink-0">
                        <AssetLibraryPanel />
                    </section>
                </div>
                <aside className="w-72 border-l border-neutral-800 bg-neutral-900 shrink-0">
                    <InspectorPanel />
                </aside>
            </div>
        </div>
    )
}

function HintsOverlay() {
    return (
        <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-neutral-500 font-mono space-y-0.5">
            <div>Click: select · Click no vazio: deselect</div>
            <div>E/R/S: translate / rotate / scale (C4D style)</div>
            <div>Ctrl+Z / Ctrl+Shift+Z: undo/redo · Ctrl+D: duplicate · Del: remove</div>
        </div>
    )
}

function useEditorShortcuts() {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null
            const tag = target?.tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return

            const s = useEditorStore.getState()

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault()
                if (e.shiftKey) s.redo()
                else s.undo()
                return
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault()
                s.redo()
                return
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
                e.preventDefault()
                if (s.selectedId) s.duplicateInstance(s.selectedId)
                return
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (s.selectedId) {
                    e.preventDefault()
                    s.removeInstance(s.selectedId)
                }
                return
            }

            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                if (e.key === 'e' || e.key === 'E') s.setMode('translate')
                else if (e.key === 'r' || e.key === 'R') s.setMode('rotate')
                else if (e.key === 's' || e.key === 'S') s.setMode('scale')
                else if (e.key === 'Escape') s.select(null)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])
}
