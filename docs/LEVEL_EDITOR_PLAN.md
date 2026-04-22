# Level Editor & Runtime Loader — Plano

> Objetivo: ter um editor de nível (fora do jogo) com gizmos de transform, biblioteca de assets GLB, categorias de física distintas, debug de colliders, e um formato `.json` de level que o jogo carrega em runtime. Sem sujar o bundle do jogo.

---

## 1. Arquitetura

- **Mesmo repo, mesmo Vite.** Uma rota nova `/editor` carregada via `React.lazy` + `Suspense`, para não entrar no bundle do jogo em produção.
- **Guarda de build:** `/editor` só é montada quando `import.meta.env.DEV === true` (ou flag `VITE_ENABLE_EDITOR`). Em prod, a rota simplesmente não existe e o código é eliminado por tree-shaking.
- **Roteamento mínimo:** `react-router` *ou* um switch manual em `App.tsx` com `window.location.pathname`. Preferir switch manual para não adicionar dependência.

Estrutura proposta:

```
src/
  game/                     # já existe (jogo em si)
  editor/                   # novo, lazy-loaded
    Editor.tsx              # root do editor
    state/                  # store (zustand ou reducer) com histórico de undo/redo
    panels/
      AssetLibraryPanel.tsx
      HierarchyPanel.tsx
      InspectorPanel.tsx
      ToolbarPanel.tsx      # toggles: colliders, grid, snap, modo W/E/R
    scene/
      EditorScene.tsx       # Canvas com Physics(paused) + gizmos
      PlacedInstance.tsx    # instância selecionável no mundo
      TransformGizmo.tsx    # wrapper de drei TransformControls
    io/
      manifest.ts           # discover assets via import.meta.glob
      serialize.ts          # JSON ↔ state
      saveAdapter.ts        # download OU POST para Vite plugin
  level/                    # compartilhado editor ↔ jogo
    types.ts                # LevelFile, Instance, Category, ...
    LevelLoader.tsx         # usado pelo jogo em runtime
    colliderFactory.ts      # category + asset → collider type
public/
  assets/<categoria>/*.glb
  assets/<categoria>/*.meta.json
  levels/*.json
```

## 2. Formato do level (JSON)

```jsonc
{
  "version": 1,
  "name": "office_01",
  "instances": [
    {
      "id": "uuid",
      "assetId": "office/wall_long",     // caminho relativo em public/assets sem .glb
      "category": "static-bulk",         // static-bulk | static-prop | dynamic | breakable
      "position": [x, y, z],
      "rotation": [x, y, z],              // euler em radianos, XYZ order
      "scale":    [x, y, z],
      "props": {                           // opcional, override do meta
        "mass": 5,
        "fractureThreshold": 30,
        "fracturedAssetId": "office/wall_long_fractured"
      }
    }
  ]
}
```

Regras:

- Posição/rotação/escala sempre em **world-space**. Sem hierarquia pai/filho.
- `assetId` é resolvido contra o manifest (`public/assets/**/*.glb`).
- `category` define defaults de colisor e tipo de corpo Rapier.
- `props` só sobrescreve valores do `.meta.json` do asset.

## 3. Asset manifest

- Cada GLB em `public/assets/<cat>/<nome>.glb`.
- Sidecar opcional `<nome>.meta.json`:

```jsonc
{
  "category": "static-prop",
  "collider": "cuboid",          // cuboid | convexHull | none
  "uniformScaleOnly": false,
  "mass": 10,
  "fractureThreshold": null,
  "fracturedAssetId": null,
  "thumbnail": "thumbs/desk.png" // opcional
}
```

- Discovery em build-time:

```ts
const glbs = import.meta.glob('/assets/**/*.glb', { eager: false });
const metas = import.meta.glob('/assets/**/*.meta.json', { eager: true });
```

- Thumbnails: se não houver PNG, gerar on-demand um render off-screen (1ª vez) e cachear em `IndexedDB`. **MVP: sem thumbnail, só nome.**

## 4. Categorias → Rapier

| Category        | Body type       | Collider default | Escala livre?   | Uso                                      |
|-----------------|-----------------|------------------|-----------------|------------------------------------------|
| `static-bulk`   | `fixed`         | `cuboid`         | Sim             | Chão, paredes grandes, teto              |
| `static-prop`   | `fixed`         | `cuboid`/`hull`  | Sim             | Colunas, pequenas paredes, mesas fixas   |
| `dynamic`       | `dynamic`       | `cuboid`/`hull`  | Não (uniforme)  | Caixas, cadeiras soltas                  |
| `breakable`     | `dynamic`/`fixed` até quebrar | `cuboid` | Não (uniforme) | Objetos que fraturam sob impacto  |

**Evitar `trimesh` em bulk structures** — colisões ficam caras. Compor com cuboides.

**Travar escala não-uniforme em `dynamic`/`breakable`** — Rapier tem mau comportamento com non-uniform scale em shapes rotacionadas.

## 5. Breakables

- Pré-fraturar no Blender (Cell Fracture add-on) → exportar GLB com pedaços como children.
- Runtime:
  1. Instance "inteira" monitora impulsos (`onCollisionEnter` com `totalForceMagnitude`).
  2. Se `force > fractureThreshold`: despawn da inteira → spawn do `fracturedAssetId`.
  3. Cada pedaço vira `RigidBody dynamic` com impulso inicial derivado do vetor da colisão.
  4. Auto-despawn dos pedaços após N segundos OU quando saírem do frustum + em sleep.
- Sem fratura procedural em runtime.

## 6. Debug de colliders

- Rapier já suporta via `<Physics debug={true}>`.
- No editor: toggle na toolbar.
- No jogo: também expor no painel Leva (dev only), útil durante playtest.
- Complemento: pintar meshes selecionados com outline (usar `drei/OutlineEffect` ou post-process).

## 7. Gizmos

- `drei.TransformControls` (`W` = translate, `E` = rotate, `R` = scale — padrão Blender/Unity).
- Snap opcional: `shift` → snap de 0.5 un em translate, 15° em rotate.
- Bloquear scale para categorias `dynamic` e `breakable` (ignora input ou força uniforme).
- Camera: `MapControls` ou `OrbitControls` (orbit é suficiente para começar).
- Seleção: clique em mesh → seta como alvo do gizmo. `Escape` limpa seleção.

## 8. Persistência (save/load)

- **MVP (fase 1):** export como download (`Blob` + `a.click()`) e import via `<input type=file>`.
- **Fase 2:** plugin Vite dev-only que expõe `POST /__editor__/save` escrevendo em `public/levels/<nome>.json`. Ganho: `Ctrl+S` salva, hot-reload no jogo.
- Nunca embutir nada disso em build de produção.

## 9. Runtime loader (do jogo)

```tsx
<LevelLoader src="/levels/office_01.json" />
```

Responsabilidades:

1. `fetch` do JSON.
2. Pré-carregar GLBs únicos via `useGLTF.preload` em paralelo.
3. Gerar `<RigidBody>` + mesh por instance.
4. Derivar collider a partir de `category` + `meta.collider` via `colliderFactory`.
5. Suspense boundary com tela de loading.

Performance:
- `SkeletonUtils.clone` ou `Object3D.clone(true)` para cada instância (sem recriar geometry/material).
- Materials compartilhados.
- Avaliar `InstancedMesh` só se telemetria mostrar muitos drawcalls iguais (não fazer upfront — vide nota abaixo).

## 10. Notas de performance / críticas importantes

- **Instancing ≠ economia de física.** `InstancedMesh` corta drawcalls mas não reduz corpos Rapier. Não vale complicar o MVP com isso.
- **Shadow maps são caros.** `shadow-mapSize={[4096, 4096]}` com vários objetos custa caro. Em cenas grandes, baixar para 2048 ou usar cascaded shadows.
- **Fog + limite de `far`**: garantir que `fogFar` corta render bem antes de `camera.far`.
- **Scene graph plano** (sem pai/filho) simplifica culling, serialization e diff para undo.
- **Budget de triângulos** por GLB: definir um alvo (~5-15k tris por prop de escritório) e auditar na importação.
- **Lightmaps / baked lighting**: para cenário estático futuro, considerar em vez de muitas luzes dinâmicas.

## 11. Undo/Redo

- Store com pilha de comandos invertíveis: `AddInstance`, `RemoveInstance`, `TransformInstance`, `ChangeCategory`, `ChangeProps`.
- `Ctrl+Z` / `Ctrl+Shift+Z`.
- Snapshots baratos: só o delta, não o state inteiro.
- Implementar no dia 1 — retrofit depois é caro.

## 12. Pontos abertos / decisões pendentes

- [ ] Zustand vs `useReducer` puro para o store do editor.
- [ ] Escolher biblioteca de UI para panels (shadcn, radix, ou CSS custom — já temos Tailwind).
- [ ] Estratégia de thumbnail de asset (none / pré-render / runtime).
- [ ] Usar `react-router` ou switch manual por `location.pathname`.
- [ ] Padronizar nomes de arquivo de asset (snake_case + pasta por set).

---

## Tasks — próximas iterações

### Fase 0 — esqueleto (sem editor ainda)
- [ ] Criar `src/level/types.ts` com `LevelFile`, `Instance`, `Category`, `Props`.
- [ ] Criar `src/level/colliderFactory.ts` com mapeamento `category + meta → {bodyType, colliderArgs}`.
- [ ] Criar `src/level/LevelLoader.tsx` capaz de carregar um JSON de teste com 2-3 instâncias placeholder (cubos).
- [ ] Adicionar rota de carregamento no jogo (substitui / convive com `Platforms.tsx`).
- [ ] Criar `public/levels/sample.json` e validar que o jogo roda com ele.

### Fase 1 — editor MVP
- [ ] Setup rota `/editor` lazy-loaded, protegida por `import.meta.env.DEV`.
- [ ] `EditorScene` com `Physics paused`, grid, `OrbitControls`.
- [ ] Store do editor (zustand) com instances + seleção + histórico undo/redo.
- [ ] `AssetLibraryPanel` lendo `import.meta.glob` de `/public/assets/**/*.glb`.
- [ ] Drag/click do painel → adicionar instância na origem.
- [ ] `TransformGizmo` com `W/E/R` e snap com `shift`.
- [ ] `InspectorPanel` (categoria, props, transform numérico).
- [ ] Toolbar: toggle debug de colliders (`Physics debug`).
- [ ] Export JSON (download).
- [ ] Import JSON (file input).
- [ ] Atalhos: `Ctrl+Z/Y`, `Delete`, `Ctrl+D` (duplicar), `F` (frame camera em seleção).

### Fase 2 — workflow de assets
- [ ] Suporte a `.meta.json` sidecar por GLB.
- [ ] Defaults por categoria quando `.meta.json` ausente.
- [ ] Bloqueio de escala não-uniforme em `dynamic`/`breakable`.
- [ ] Preview/thumbnail no `AssetLibraryPanel` (render off-screen + cache em IndexedDB).
- [ ] Plugin Vite dev-only `POST /__editor__/save` e hotkey `Ctrl+S`.

### Fase 3 — breakables
- [ ] Convenção de asset `X.glb` + `X_fractured.glb`.
- [ ] Componente `BreakableInstance` com listener de impulso.
- [ ] Troca para variante fraturada + spawn dos pedaços com impulso.
- [ ] Auto-despawn de pedaços (timer + sleep).
- [ ] Campo `fractureThreshold` no inspector.

### Fase 4 — polimento
- [ ] Outline em seleção.
- [ ] Múltipla seleção (grupo de transform).
- [ ] Copy/paste entre levels.
- [ ] Validação de level no load (schema zod?).
- [ ] Otimização: InstancedMesh para repetidos (>N do mesmo asset), após medição.

