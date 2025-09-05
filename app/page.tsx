"use client"
import { useState } from "react"

export default function HomePage() {
  const [logs, setLogs] = useState<string[]>([])
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [aiPrompt, setAiPrompt] = useState("")
  const [generatedFiles, setGeneratedFiles] = useState<any>(null)
  const [analyzeUrl, setAnalyzeUrl] = useState("")
  const [analyzedContent, setAnalyzedContent] = useState<any>(null)
  const [analyzeLoading, setAnalyzeLoading] = useState(false)

  const runAction = async (action: string, sandboxId?: string, aiFiles?: any) => {
    const res = await fetch("/api/sandbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, sandboxId, aiFiles }),
    })
    return res.json()
  }

  const analyzeWebsite = async () => {
    if (!analyzeUrl.trim()) {
      setLogs((prev) => [...prev, "❌ Veuillez entrer une URL à analyser"])
      return
    }

    setAnalyzeLoading(true)
    setLogs((prev) => [...prev, `🔍 Analyse du site: ${analyzeUrl}`])

    try {
      const response = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: analyzeUrl }),
      })

      const result = await response.json()

      if (result.error) {
        throw new Error(result.error)
      }

      setAnalyzedContent(result)
      setLogs((prev) => [...prev, "✅ Analyse terminée avec succès"])
    } catch (error: any) {
      setLogs((prev) => [...prev, `❌ Erreur d'analyse: ${error.message}`])
    } finally {
      setAnalyzeLoading(false)
    }
  }

  const generateWithAI = async () => {
    if (!aiPrompt.trim()) {
      setLogs((prev) => [...prev, "❌ Veuillez entrer un prompt pour l'IA"])
      return
    }

    setLogs((prev) => [...prev, "🤖 Génération avec Gemini AI..."])

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt }),
      })

      const result = await response.json()

      if (result.error) {
        throw new Error(result.error)
      }

      if (result.success && result.files) {
        setGeneratedFiles(result.files)
        setLogs((prev) => [...prev, "✅ Fichiers générés par l'IA avec succès"])
        return result.files
      } else {
        throw new Error("Réponse invalide de l'API Gemini")
      }
    } catch (error: any) {
      setLogs((prev) => [...prev, `❌ Erreur IA: ${error.message}`])
      return null
    }
  }

  const startNext = async () => {
    setLoading(true)
    setLogs(["🚀 Démarrage du sandbox..."])

    try {
      let aiFiles = generatedFiles
      if (aiPrompt.trim() && !aiFiles) {
        aiFiles = await generateWithAI()
        if (!aiFiles) {
          throw new Error("Échec de la génération des fichiers IA")
        }
      }

      const create = await runAction("create", undefined, aiFiles)
      if (create.error) throw new Error(create.error)
      const sandboxId = create.sandboxId
      setLogs((prev) => [...prev, `✅ Sandbox créé: ${sandboxId}`])

      setLogs((prev) => [...prev, "📦 Installation des dépendances..."])
      const install = await runAction("install", sandboxId)
      if (install.error) throw new Error(install.error)
      setLogs((prev) => [...prev, ...install.logs.split("\n")])

      setLogs((prev) => [...prev, "⚡️ Build en cours..."])
      const build = await runAction("build", sandboxId)
      if (build.error) throw new Error(build.error)
      setLogs((prev) => [...prev, ...build.logs.split("\n")])

      setLogs((prev) => [...prev, "🚀 Lancement du serveur..."])
      const start = await runAction("start", sandboxId)
      if (start.error) throw new Error(start.error)
      setUrl(start.url)
      setLogs((prev) => [...prev, `🌐 Next.js en ligne: ${start.url}`])
    } catch (e: any) {
      setLogs((prev) => [...prev, `❌ Erreur: ${e.message}`])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="space-y-4 border p-4 rounded">
        <h2 className="text-lg font-semibold">🔍 Analyse de Site Web</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={analyzeUrl}
            onChange={(e) => setAnalyzeUrl(e.target.value)}
            placeholder="Entrez l'URL du site à analyser (ex: https://example.com)"
            className="flex-1 p-3 border rounded"
          />
          <button
            onClick={analyzeWebsite}
            disabled={analyzeLoading || !analyzeUrl.trim()}
            className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-50"
          >
            {analyzeLoading ? "⏳ Analyse..." : "Launch Analyse"}
          </button>
        </div>

        {analyzedContent && (
          <div className="mt-4">
            <h3 className="text-md font-semibold mb-2">Aperçu du site analysé:</h3>
            <iframe
              srcDoc={`
                <!DOCTYPE html>
                <html>
                <head>
                  <style>${analyzedContent.fullCSS}</style>
                </head>
                <body>
                  ${analyzedContent.fullHTML}
                  <script>${analyzedContent.fullJS}</script>
                </body>
                </html>
              `}
              className="w-full h-96 border rounded"
              sandbox="allow-scripts allow-same-origin"
            />
            <p className="text-sm text-gray-600 mt-2">Site analysé: {analyzedContent.baseURL}</p>
          </div>
        )}
      </div>

      <div className="space-y-4 border p-4 rounded">
        <h2 className="text-lg font-semibold">🤖 Génération avec Gemini AI</h2>
        <textarea
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          placeholder="Décrivez l'application Next.js que vous voulez générer..."
          className="w-full p-3 border rounded h-24 resize-none"
        />
        <button
          onClick={generateWithAI}
          disabled={loading || !aiPrompt.trim()}
          className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
        >
          Générer avec IA
        </button>
        {generatedFiles && <div className="text-sm text-green-600">✅ Fichiers générés prêts à être déployés</div>}
      </div>

      <button onClick={startNext} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded">
        {loading ? "⏳ En cours..." : "Start Next.js in Sandbox"}
      </button>

      <pre className="mt-4 p-4 bg-gray-100 rounded whitespace-pre-wrap">{logs.join("\n")}</pre>

      {url && (
        <p>
          🌐 Votre app Next.js est disponible ici :{" "}
          <a href={url} target="_blank" className="text-blue-600 underline" rel="noreferrer">
            {url}
          </a>
        </p>
      )}
    </div>
  )
}
