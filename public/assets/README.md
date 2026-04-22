# Assets

Pasta de GLBs do jogo. Organize por "set" ou "categoria de uso":

```
public/assets/
├── breakables/          # objetos que fraturam (intact + fractured)
├── props/               # props estáticos (cadeira, mesa, etc.)
├── structural/          # paredes, chão, teto
└── ...                  # outros sets livres
```

O caminho depois do `assets/` é o que vira o `assetId` no level JSON:

- `public/assets/breakables/crate.glb` → `assetId: "breakables/crate"`
- `public/assets/props/office_chair.glb` → `assetId: "props/office_chair"`

**Sempre sem a extensão `.glb` no `assetId`.**

## Convenção de breakables (2 arquivos)

Para cada objeto quebrável, exporte **dois GLBs** com o mesmo pivot/origem:

```
public/assets/breakables/
├── crate.glb                    # modelo inteiro
└── crate_fractured.glb          # mesmo objeto pré-fraturado (pedaços como filhos do root)
```

Regras no C4D:

- **Origem idêntica** nos dois arquivos. Comece pelo intact, salve como cópia, aplique fratura, exporte.
- No fraturado, **cada pedaço deve ser um mesh filho do root** (não agrupado em subgrupo). O loader trata cada filho como um `RigidBody` dinâmico.
- **Pivot de cada pedaço no centro geométrico do pedaço** (C4D: selecione o pedaço, menu Axis → Axis Center → Object Center). Isso garante rotação física natural.
- Unidade em **metros** (Project Scale: Meters).
- Export glTF 2.0 Binary (`.glb`), Embed Textures = SIM.

## Meta sidecar (opcional, mas recomendado para breakables)

Ao lado de `crate.glb`, crie `crate.meta.json`:

```json
{
    "category": "breakable",
    "mass": 8,
    "fractureThreshold": 30,
    "fracturedAssetId": "breakables/crate_fractured",
    "debrisMass": 0.6,
    "debrisLifetimeMs": 6000
}
```

- `fractureThreshold` — magnitude mínima do impulso (N·s) para quebrar.
- `debrisMass` — massa de cada pedaço após a fratura.
- `debrisLifetimeMs` — após esse tempo parado, pedaços são despawnados.
- `fracturedAssetId` — se omitido, o loader usa a convenção `<assetId>_fractured`.

## Dicas de tamanho

- Prop típico de escritório: **1–3 MB**, geometria 3k–15k tris.
- Breakable (objeto + fraturado): **até 5 MB combinados**, <30k tris totais.
- Textura: **1024 ou 2048**, raramente 4K.
