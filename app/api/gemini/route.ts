// app/api/gemini/route.ts
import { NextResponse } from "next/server"
import { GoogleGenAI } from "@google/genai"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { prompt, action, designContext, contents, model: requestedModel, applyMode, projectName } = body

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY manquant" }, { status: 500 })
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey,
    })

    const tools = [
      {
        googleSearch: {},
      },
    ]

    const config = {
      thinkingConfig: {
        thinkingBudget: -1,
      },
      tools,
    }

    const model = requestedModel || "gemini-2.5-flash"

    if (contents && Array.isArray(contents)) {
      const response = await ai.models.generateContentStream({
        model,
        config,
        contents,
      })

      let fullResponse = ""
      for await (const chunk of response) {
        if (chunk.text) {
          fullResponse += chunk.text
        }
      }

      return NextResponse.json({ success: true, text: fullResponse })
    }

    if (!prompt) {
      return NextResponse.json({ error: "Prompt manquant" }, { status: 400 })
    }

    let enhancedPrompt = `Génère une application Next.js complète basée sur cette demande: "${prompt}". 

Tu peux créer TOUS les fichiers nécessaires dans le projet Next.js, par exemple:
- Pages: app/page.tsx, app/about/page.tsx, app/contact/page.tsx, etc.
- Composants: components/Header.tsx, components/Footer.tsx, components/Button.tsx, etc.
- Utilitaires: lib/utils.ts, hooks/useCustomHook.ts, etc.
- Configuration: package.json (SEULEMENT si nécessaire avec des dépendances spéciales)

⚠️ INTERDICTION ABSOLUE - NE GÉNÈRE JAMAIS CES FICHIERS:
- app/globals.css (INTERDIT - existe déjà)
- *.css (INTERDIT - tous fichiers CSS)
- styles/* (INTERDIT - dossier styles)

EXEMPLE DE PACKAGE.JSON CORRECT AVEC TAILWIND (utilise cet exemple si tu dois en créer un):
{
  "name": "nextjs-app",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000 -H 0.0.0.0",
    "build": "next build",
    "start": "next start -p 3000 -H 0.0.0.0"
  },
  "dependencies": {
    "next": "14.2.3",
    "react": "18.2.0",
    "react-dom": "18.2.0",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "typescript": "^5"
  },
  "devDependencies": {
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}

RÈGLES IMPORTANTES POUR LES STYLES:
- N'importe JAMAIS globals.css dans tes composants (import './globals.css' est INTERDIT)
- Les styles globaux sont automatiquement chargés via app/layout.tsx
- Utilise uniquement les classes Tailwind CSS ou les classes CSS définies dans globals.css
- Si tu crées des composants, utilise className avec Tailwind ou les classes existantes
- ⚠️ INTERDIT: Ne crée AUCUN fichier CSS - utilise uniquement les classes existantes

CONFIGURATION TAILWIND AUTOMATIQUE:
Si tu génères un package.json avec Tailwind, inclus aussi ces fichiers de configuration:

tailwind.config.js:
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

postcss.config.js:
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}

RÈGLES IMPORTANTES POUR ÉVITER LES PAYLOADS TROP VOLUMINEUX:
- Ne génère package.json QUE si tu as besoin de dépendances spéciales
- ÉVITE d'inclure de gros blocs de CSS inline ou de HTML brut
- Utilise des classes CSS concises et des composants modulaires
- Limite les fichiers à 50KB maximum chacun
- NE GÉNÈRE PAS DE FICHIERS DE STYLES CSS(app/globals.css, etc... Ne le génère surtout pas, ils seront créé automatiquement donc ne les génèrent plus et pas du tout )
- Privilégie les références aux styles plutôt que le CSS complet
- Ne génère PAS app/page.tsx et app/globals.css - ils seront créés automatiquement`

    // Récupération du contenu HTML/CSS brut depuis le localStorage si un projet existe
    if (projectName) {
      try {
        // Simuler la récupération depuis localStorage côté serveur
        // En réalité, ces données viennent du client via designContext
        if (designContext && designContext.fullHTML && designContext.fullCSS) {
          // Nettoyer le HTML en supprimant les balises script et le JavaScript
          const cleanHTML = designContext.fullHTML
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/on\w+="[^"]*"/gi, "")
            .replace(/javascript:[^"']*/gi, "")

          enhancedPrompt += `

🎨 CODES HTML ET CSS EXTRAITS DU SITE ANALYSÉ:

Voici les codes HTML et CSS que tu dois complètement utiliser pour générer le design des autres pages :

=== CODE HTML STRUCTURE (sans JavaScript) ===
${cleanHTML.substring(0, 15000)} ${cleanHTML.length > 15000 ? "...[HTML tronqué pour éviter payload trop volumineux]" : ""}

=== CODE CSS COMPLET ===
${designContext.fullCSS.substring(0, 20000)} ${designContext.fullCSS.length > 20000 ? "...[CSS tronqué pour éviter payload trop volumineux]" : ""}

🔥 INSTRUCTIONS CRITIQUES POUR UTILISER CES CODES :

1. COPIE COMPLÈTEMENT la structure HTML du code HTML que tu vois ci-dessus
2. Utilise les MÊMES classes CSS exactement comme dans le HTML fourni
3. COMPRENDS pourquoi tel div fait appel à telle classe CSS et quel est le résultat visuel obtenu
4. RÉUTILISE ces mêmes structures du code analysé pour créer d'autres pages
5. Le code CSS que tu as vu ci-dessus est DÉJÀ AUTOMATIQUEMENT ajouté dans le fichier app/globals.css
6. C'est pourquoi tu n'auras PLUS JAMAIS besoin de générer de fichier CSS
7. Tu dois COMPLÈTEMENT copier le HTML et sa structure en utilisant les MÊMES classes CSS
8. Ces classes CSS existent déjà dans globals.css - utilise-les directement

⚠️ RÈGLE ABSOLUE : Le CSS ci-dessus est DÉJÀ dans app/globals.css - NE LE GÉNÈRE PLUS JAMAIS !`
        }
      } catch (error) {
        console.error("Erreur lors de la récupération du contenu HTML/CSS:", error)
      }
    }

    if (designContext) {
      enhancedPrompt += `

CONTEXTE DE DESIGN À RESPECTER:
Tu as accès au design context qui contient la structure et les styles du site principal.
- Site cloné: ${designContext.isCloned ? "Oui" : "Non"}
- Structure disponible: ${designContext.htmlStructure ? "Oui" : "Non"}

🚫 INTERDICTION ABSOLUE DE GÉNÉRER DES FICHIERS CSS:
- Le fichier app/globals.css EXISTE DÉJÀ avec TOUTES les classes CSS nécessaires
- Tu dois SEULEMENT utiliser les classes CSS existantes, JAMAIS en créer de nouvelles
- ⚠️ INTERDIT: "app/globals.css", "styles.css", "*.css" - AUCUN fichier CSS autorisé
- ⚠️ INTERDIT: @font-face, :root, variables CSS - tout existe déjà

RÈGLES STRICTES POUR LA CONTINUITÉ DE DESIGN:
- UTILISE UNIQUEMENT les classes CSS existantes du design context
- RÉUTILISE la même structure HTML et les mêmes patterns de design
- Crée UNIQUEMENT les nouvelles pages demandées (ex: app/about/page.tsx, app/contact/page.tsx)
- Les nouvelles pages doivent utiliser les mêmes classes CSS que celles présentes dans le design context

RAPPEL IMPORTANT: 
- Tous les styles CSS, variables CSS, et @font-face sont DÉJÀ dans globals.css
- Tu ne dois créer QUE les pages JSX/TSX en utilisant les classes existantes
- AUCUN fichier CSS ne doit être généré, peu importe les circonstances`
    }

    enhancedPrompt += `

🚫 LISTE DES FICHIERS INTERDITS (ne génère JAMAIS):
- app/globals.css
- styles.css
- *.css (tous fichiers CSS)
- app/page.tsx (si design context existe)

Retourne UNIQUEMENT un objet JSON avec cette structure exacte:
{
  "package.json": "contenu du package.json (SEULEMENT si dépendances spéciales nécessaires)",
  "app/layout.tsx": "contenu du layout principal (si nécessaire)",
  "components/NomComposant.tsx": "contenu du composant (si nécessaire)",
  "app/about/page.tsx": "page about (si demandée)",
  "lib/utils.ts": "utilitaires (si nécessaires)",
  // ... autres fichiers selon les besoins - MAIS JAMAIS DE FICHIERS CSS
}

⚠️ RAPPEL FINAL: AUCUN fichier CSS ne doit apparaître dans ta réponse JSON. 
Utilise uniquement les classes CSS existantes dans tes composants JSX/TSX.
OPTIMISATION IMPORTANTE: Garde chaque fichier concis et modulaire. Évite les gros blocs de code ou de CSS inline. 
Crée une structure de projet logique et complète. Ne retourne que le JSON, rien d'autre.`

    const response = await ai.models.generateContentStream({
      model,
      config,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: enhancedPrompt,
            },
          ],
        },
      ],
    })

    let fullResponse = ""
    for await (const chunk of response) {
      if (chunk.text) {
        fullResponse += chunk.text
      }
    }

    // Extraire le JSON de la réponse
    const jsonMatch = fullResponse.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const aiFiles = JSON.parse(jsonMatch[0])
      return NextResponse.json({ success: true, files: aiFiles })
    } else {
      throw new Error("Impossible d'extraire les fichiers de la réponse IA")
    }
  } catch (error: any) {
    console.error("Erreur Gemini API:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
