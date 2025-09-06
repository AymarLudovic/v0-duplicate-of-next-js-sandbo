"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Loader2, Wand2, Send, Hammer, Save, Trash2, Eye, Plus } from "lucide-react"
import type { GeminiPlan, AnalysisResult, ChatProps } from "@/types"

type StoredFile = {
  path: string
  content: string
  timestamp: number
}

type StoredProject = {
  name: string
  files: StoredFile[]
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  analysis?: AnalysisResult
  timestamp: number
}

// localStorage utilities
const STORAGE_KEY = "v0_sandbox_files"

const saveFilesToStorage = (
  projectName: string,
  files: Record<string, string>,
  deps?: Record<string, string>,
  devDeps?: Record<string, string>,
  analysis?: AnalysisResult,
) => {
  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as StoredProject[]
    const projectIndex = existing.findIndex((p) => p.name === projectName)

    const storedFiles: StoredFile[] = Object.entries(files).map(([path, content]) => ({
      path,
      content,
      timestamp: Date.now(),
    }))

    const project: StoredProject = {
      name: projectName,
      files: storedFiles,
      dependencies: deps,
      devDependencies: devDeps,
      analysis,
      timestamp: Date.now(),
    }

    if (projectIndex >= 0) {
      existing[projectIndex] = project
    } else {
      existing.push(project)
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
    return true
  } catch (e) {
    console.error("Error saving to localStorage:", e)
    return false
  }
}

const getStoredProjects = (): StoredProject[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
  } catch (e) {
    console.error("Error reading from localStorage:", e)
    return []
  }
}

const deleteStoredProject = (projectName: string): boolean => {
  try {
    const existing = getStoredProjects()
    const filtered = existing.filter((p) => p.name !== projectName)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
    return true
  } catch (e) {
    console.error("Error deleting from localStorage:", e)
    return false
  }
}

const clearAllStoredFiles = (): boolean => {
  try {
    localStorage.removeItem(STORAGE_KEY)
    return true
  } catch (e) {
    console.error("Error clearing localStorage:", e)
    return false
  }
}

// ---------- helpers parsing JSON ----------
function stripCodeFenceToJson(s: string): string | null {
  const fence = s.match(/```json\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()
  const fenceAny = s.match(/```\s*([\s\S]*?)```/)
  if (fenceAny) return fenceAny[1].trim()
  return null
}

function extractFirstJsonObject(text: string): string | null {
  const s = text.replace(/\uFEFF/g, "")
  let inStr = false
  let esc = false
  let depth = 0
  let start = -1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) {
        esc = false
      } else if (ch === "\\") {
        esc = true
      } else if (ch === '"') {
        inStr = false
      }
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === "{") {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === "}") {
      if (depth > 0) depth--
      if (depth === 0 && start !== -1) {
        const candidate = s.slice(start, i + 1).trim()
        try {
          JSON.parse(candidate)
          return candidate
        } catch {
          start = -1
        }
      }
      continue
    }
  }
  return null
}

function safeParsePlan(fullText: string): GeminiPlan {
  const f = stripCodeFenceToJson(fullText)
  if (f) return JSON.parse(f)
  const first = extractFirstJsonObject(fullText)
  if (first) return JSON.parse(first)
  if (fullText.trim() === "") {
    throw new Error("Cannot parse empty string as JSON.")
  }
  return JSON.parse(fullText.trim())
}

// ---------- helpers de génération ----------
const escForTemplate = (s: string) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")

const buildPageFromAnalysis = (analysis: AnalysisResult, projectName: string) => {
  const html = escForTemplate(analysis.fullHTML || "")
  const js = escForTemplate(analysis.fullJS || "")

  return `"use client";
import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    try {
      // Inject JS directly
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.innerHTML = \`${js}\`;
      document.body.appendChild(script);
      
      return () => {
        try {
          script.remove();
        } catch(e) {}
      };
    } catch(e) {
      console.error('Erreur injection JS:', e);
    }
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: \`${html}\` }} />;
}`
}

const buildGlobalsCssFromAnalysis = (analysis: AnalysisResult) => {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

${
  analysis.fullCSS ||
  `/* Base styles */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

* {
  box-sizing: border-box;
}

body {
  font-family: 'Inter', sans-serif;
  margin: 0;
  padding: 0;
}`
}`
}

// ---------------- Chat component ----------------
function Chat({ onApplyPlan, onRequestAnalysis, onCombineWithStored }: ChatProps) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([
    {
      role: "assistant",
      text: "Salut ! Je suis Gemini. Pose une question, ou coche le mode 'Appliquer au sandbox' pour générer un plan JSON complet.",
    },
  ])
  const [input, setInput] = useState("")
  const [applyMode, setApplyMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savedDesign, setSavedDesign] = useState<AnalysisResult | null>(null)
  const [selectedStoredProject, setSelectedStoredProject] = useState<string>("")

  const systemPlanHint = `Tu es un assistant expert pour la création de sites Next.js.

🚫 INTERDICTION ABSOLUE DE GÉNÉRER DES FICHIERS CSS 🚫
- NE génère JAMAIS de fichier "app/globals.css"
- NE génère JAMAIS de fichier "globals.css" 
- NE génère JAMAIS de fichier ".css"
- Les styles CSS existent DÉJÀ dans le projet
- Utilise UNIQUEMENT les classes CSS existantes
- Le fichier globals.css est DÉJÀ créé automatiquement

Avant de générer les fichiers Next.js, détecte si le prompt implique de cloner un site réel ou de récupérer son contenu.
Si oui, retourne UN JSON STRICT (voir schéma ci-dessous) OU un objet avec "actions" listant "requestAnalysis" + "writeAnalyzed".

IMPORTANT: Respecte EXACTEMENT le chemin de fichier demandé par l'utilisateur. Si il demande "app/page.tsx", écris dans "app/page.tsx". Si il demande "app/about/page.tsx", écris dans "app/about/page.tsx".

Schéma JSON attendu:
{
  "files": { "<chemin relatif>": "<contenu du fichier>" },
  "dependencies": { "lib": "version" },
  "devDependencies": { "lib": "version" },
  "commands": ["npm install ..."],
  "actions": [
    { "type": "requestAnalysis", "url": "https://example.com", "target": "page" },
    { "type": "writeAnalyzed", "path": "<chemin demandé par l'utilisateur>", "fromAnalysisOf": "https://example.com" }
  ]
}

Réponds UNIQUEMENT par un JSON valide et rien d'autre.`.trim()

  const buildDesignContextPart = (design: AnalysisResult | null, maxCssChars = 4000) => {
    if (!design) return null
    const css = design.fullCSS
      ? design.fullCSS.length > maxCssChars
        ? design.fullCSS.slice(0, maxCssChars) + "\n/*...truncated...*/"
        : design.fullCSS
      : ""
    const htmlSnippet = design.fullHTML
      ? design.fullHTML.length > 2000
        ? design.fullHTML.slice(0, 2000) + "...truncated..."
        : design.fullHTML
      : ""
    return `DESIGN_CONTEXT:
Réutilise les mêmes classes, couleurs, backgrounds et layout pour garder la continuité visuelle sur toutes les pages générées.

CSS:
${css}

HTML snippet:
${htmlSnippet}`
  }

  const handleSend = async () => {
    if (!input.trim()) return
    setLoading(true)
    const userMsg = input
    setMessages((m) => [...m, { role: "user", text: userMsg }])
    setInput("")

    try {
      const contents: any[] = []

      if (applyMode) {
        contents.push({ role: "user", parts: [{ text: systemPlanHint }] })

        if (selectedStoredProject) {
          const storedAnalysis = getStoredAnalysis(selectedStoredProject)
          if (storedAnalysis) {
            setSavedDesign(storedAnalysis)
            setMessages((m) => [
              ...m,
              { role: "assistant", text: "🎨 Récupération des designs pour une continuité sur les autres pages..." },
            ])
          }
        }

        if (savedDesign) {
          contents.push({ role: "user", parts: [{ text: buildDesignContextPart(savedDesign) }] })
          setMessages((m) => [
            ...m,
            { role: "assistant", text: "🎨 Design global détecté → sera réutilisé pour la continuité visuelle." },
          ])
        }
      }

      contents.push({ role: "user", parts: [{ text: userMsg }] })

      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          model: "gemini-2.5-flash",
          applyMode,
        }),
      })

      const result = await response.json()
      if (result.error) throw new Error(result.error)

      const full = result.text || "[réponse vide]"
      setMessages((m) => [...m, { role: "assistant", text: full }])

      if (applyMode) {
        let plan: GeminiPlan | null = null
        try {
          plan = safeParsePlan(full)
        } catch {
          throw new Error("Impossible de parser le JSON de Gemini.")
        }

        if (!plan) throw new Error("Gemini n'a pas produit de plan JSON valide.")

        const normalized: GeminiPlan = {
          files: plan.files ? { ...plan.files } : {},
          delete: plan.delete ?? [],
          dependencies: plan.dependencies,
          devDependencies: plan.devDependencies,
          commands: plan.commands ? [...plan.commands] : [],
          actions: plan.actions,
        }

        if (Array.isArray(normalized.actions)) {
          for (const action of normalized.actions) {
            if (action.type === "requestAnalysis" && onRequestAnalysis) {
              const url = action.url || action.fromAnalysisOf
              if (!url) continue
              const analysis = await onRequestAnalysis(url)
              setSavedDesign(analysis)
              normalized.files = normalized.files || {}

              normalized.files["tailwind.config.js"] = `/** @type {import('tailwindcss').Config} */
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
}`

              normalized.files["postcss.config.js"] = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`

              normalized.devDependencies = {
                ...normalized.devDependencies,
                tailwindcss: "^3.4.0",
                autoprefixer: "^10.4.0",
                postcss: "^8.4.0",
              }

              normalized.files["design.json"] = JSON.stringify(
                {
                  baseURL: analysis.baseURL,
                  title: analysis.title,
                  description: analysis.description,
                  timestamp: Date.now(),
                },
                null,
                2,
              )
            }
            if (action.type === "writeAnalyzed" && onRequestAnalysis) {
              const url = action.fromAnalysisOf || action.url
              if (url) {
                const analysis = await onRequestAnalysis(url)
                setSavedDesign(analysis)

                const dest = action.path || "app/page.tsx"
                const currentProjectName = selectedStoredProject || "default"

                normalized.files = normalized.files || {}

                normalized.files[dest] = buildPageFromAnalysis(analysis, currentProjectName)
                normalized.files["app/globals.css"] = buildGlobalsCssFromAnalysis(analysis)

                normalized.files["tailwind.config.js"] = `/** @type {import('tailwindcss').Config} */
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
}`

                normalized.files["postcss.config.js"] = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`

                normalized.devDependencies = {
                  ...normalized.devDependencies,
                  tailwindcss: "^3.4.0",
                  autoprefixer: "^10.4.0",
                  postcss: "^8.4.0",
                }

                normalized.files["design.json"] = JSON.stringify(
                  {
                    baseURL: analysis.baseURL,
                    title: analysis.title,
                    description: analysis.description,
                    timestamp: Date.now(),
                  },
                  null,
                  2,
                )
              } else if (action.path && typeof action["content"] === "string") {
                normalized.files = normalized.files || {}
                normalized.files[action.path] = action["content"]
              }
            }
          }
        }

        if (selectedStoredProject && onCombineWithStored) {
          const storedProjects = getStoredProjects()
          const project = storedProjects.find((p) => p.name === selectedStoredProject)
          if (project) {
            const storedFiles: Record<string, string> = {}
            project.files.forEach((f) => {
              storedFiles[f.path] = f.content
            })
            await onCombineWithStored(storedFiles, normalized)
            setMessages((m) => [
              ...m,
              {
                role: "assistant",
                text: `✅ Plan combiné avec les fichiers stockés de "${selectedStoredProject}" et appliqué au sandbox.`,
              },
            ])
            return
          }
        }

        await onApplyPlan(normalized)
        setMessages((m) => [
          ...m,
          { role: "assistant", text: "✅ Plan appliqué dans le sandbox (fichiers écrits + commandes exécutées)." },
        ])
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", text: "❌ Erreur Gemini: " + (e?.message || String(e)) }])
    } finally {
      setLoading(false)
    }
  }

  const storedProjects = getStoredProjects()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5" />
          Chat Gemini (édition du sandbox)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-72 bg-muted rounded p-2 overflow-y-auto text-sm">
          {messages.map((m, i) => (
            <div key={i} className={`mb-2 ${m.role === "user" ? "text-blue-700" : "text-emerald-700"}`}>
              <b>{m.role === "user" ? "Vous" : "Gemini"}:</b> {m.text}
            </div>
          ))}
        </div>

        {applyMode && storedProjects.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Combiner avec projet stocké:</label>
            <select
              value={selectedStoredProject}
              onChange={(e) => setSelectedStoredProject(e.target.value)}
              className="flex-1 p-2 border rounded text-sm"
            >
              <option value="">Nouveau projet</option>
              {storedProjects.map((project) => (
                <option key={project.name} value={project.name}>
                  {project.name} ({project.files.length} fichiers)
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={applyMode ? "Décris le site et demande un plan JSON à appliquer..." : "Discute avec Gemini..."}
            onKeyDown={(e) => e.key === "Enter" && !loading && handleSend()}
          />
          <Button
            variant={applyMode ? "default" : "secondary"}
            onClick={() => setApplyMode((v) => !v)}
            title="Basculer mode Apply"
          >
            <Hammer className="h-4 w-4" />
          </Button>
          <Button onClick={handleSend} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Mode: {applyMode ? "🛠️ Appliquer au sandbox (JSON attendu)" : "💬 Discussion libre"}
        </p>
      </CardContent>
    </Card>
  )
}

const getStoredAnalysis = (projectName: string): AnalysisResult | null => {
  try {
    const projects = getStoredProjects()
    const project = projects.find((p) => p.name === projectName)
    return project?.analysis || null
  } catch (e) {
    console.error("Error reading analysis from localStorage:", e)
    return null
  }
}

// ---------------- LocalStorageManager component ----------------
function LocalStorageManager() {
  const [storedProjects, setStoredProjects] = useState<StoredProject[]>([])
  const [selectedProject, setSelectedProject] = useState<StoredProject | null>(null)
  const [showFileContent, setShowFileContent] = useState<string | null>(null)
  const [showAnalysis, setShowAnalysis] = useState<boolean>(false)

  useEffect(() => {
    setStoredProjects(getStoredProjects())
  }, [])

  const refreshProjects = () => {
    setStoredProjects(getStoredProjects())
    setSelectedProject(null)
    setShowFileContent(null)
    setShowAnalysis(false)
  }

  const handleDeleteProject = (projectName: string) => {
    if (confirm(`Supprimer le projet "${projectName}" ?`)) {
      deleteStoredProject(projectName)
      refreshProjects()
    }
  }

  const handleClearAll = () => {
    if (confirm("Supprimer TOUS les projets stockés ?")) {
      clearAllStoredFiles()
      refreshProjects()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Save className="h-5 w-5" />
          Gestionnaire de fichiers localStorage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button onClick={refreshProjects} variant="outline" size="sm">
            <Eye className="h-4 w-4 mr-1" />
            Actualiser
          </Button>
          <Button onClick={handleClearAll} variant="destructive" size="sm">
            <Trash2 className="h-4 w-4 mr-1" />
            Tout supprimer
          </Button>
        </div>

        {storedProjects.length === 0 ? (
          <p className="text-muted-foreground text-sm">Aucun projet stocké</p>
        ) : (
          <div className="space-y-2">
            {storedProjects.map((project) => (
              <div key={project.name} className="border rounded p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium flex items-center gap-2">
                      {project.name}
                      {project.analysis && (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">🎨 Design</span>
                      )}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {project.files.length} fichiers • {new Date(project.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      onClick={() => setSelectedProject(selectedProject?.name === project.name ? null : project)}
                      variant="outline"
                      size="sm"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button onClick={() => handleDeleteProject(project.name)} variant="destructive" size="sm">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {selectedProject?.name === project.name && (
                  <div className="mt-3 space-y-2">
                    {project.analysis && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h5 className="font-medium text-sm">🎨 Design Context:</h5>
                          <Button onClick={() => setShowAnalysis(!showAnalysis)} variant="ghost" size="sm">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                        {showAnalysis && (
                          <div className="bg-blue-50 p-2 rounded text-xs">
                            <p>
                              <strong>URL:</strong> {project.analysis.baseURL}
                            </p>
                            <p>
                              <strong>HTML:</strong> {project.analysis.fullHTML?.length || 0} caractères
                            </p>
                            <p>
                              <strong>CSS:</strong> {project.analysis.fullCSS?.length || 0} caractères
                            </p>
                            <p>
                              <strong>JS:</strong> {project.analysis.fullJS?.length || 0} caractères
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    <h5 className="font-medium text-sm">Fichiers:</h5>
                    {project.files.map((file) => (
                      <div key={file.path} className="flex items-center justify-between bg-muted p-2 rounded">
                        <span className="text-sm font-mono">{file.path}</span>
                        <Button
                          onClick={() => setShowFileContent(showFileContent === file.path ? null : file.path)}
                          variant="ghost"
                          size="sm"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    {showFileContent && (
                      <div className="mt-2">
                        <h6 className="font-medium text-sm mb-1">Contenu de {showFileContent}:</h6>
                        <pre className="bg-gray-100 p-2 rounded text-xs overflow-auto max-h-40">
                          {project.files.find((f) => f.path === showFileContent)?.content || "Contenu non trouvé"}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------- Main TestPage component ----------------
export default function TestPage() {
  const [logs, setLogs] = useState<string[]>([])
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [projectUrl, setProjectUrl] = useState<string | null>(null)
  const [routeInput, setRouteInput] = useState("")
  const [projectName, setProjectName] = useState("")
  const [showAddFiles, setShowAddFiles] = useState(false)
  const [currentSandboxId, setCurrentSandboxId] = useState<string | null>(null)
  const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisResult | null>(null)

  const runAction = async (action: string, sandboxId?: string, aiFiles?: any) => {
    try {
      const res = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sandboxId, aiFiles }),
      })

      const contentType = res.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await res.text()
        throw new Error(`Réponse non-JSON reçue: ${textResponse.substring(0, 200)}...`)
      }

      return await res.json()
    } catch (e: any) {
      console.error("[v0] Run action error:", e)
      return { error: e.message }
    }
  }

  const requestAnalysis = async (url: string): Promise<AnalysisResult> => {
    const response = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    })
    const result = await response.json()
    if (result.error) throw new Error(result.error)
    setCurrentAnalysis(result)
    return result
  }

  const applyPlan = async (plan: GeminiPlan) => {
    setLoading(true)
    setLogs(["🚀 Démarrage du sandbox..."])

    try {
      const apply = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "applyPlan", plan }),
      })

      const contentType = apply.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await apply.text()
        throw new Error(`Réponse non-JSON reçue: ${textResponse.substring(0, 200)}...`)
      }

      const applyResult = await apply.json()
      if (applyResult.error) throw new Error(applyResult.error)

      const sandboxId = applyResult.sandboxId
      setCurrentSandboxId(sandboxId)
      setLogs((prev) => [...prev, `✅ Sandbox créé et fichiers appliqués: ${sandboxId}`])

      if (projectName.trim() && plan.files) {
        const saved = saveFilesToStorage(
          projectName.trim(),
          plan.files,
          plan.dependencies,
          plan.devDependencies,
          currentAnalysis,
        )
        if (saved) {
          setLogs((prev) => [...prev, `💾 Fichiers et design sauvegardés dans localStorage: ${projectName}`])
        }
      }

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
      setProjectUrl(start.url)
      setLogs((prev) => [...prev, `🌐 Next.js en ligne: ${start.url}`])

      setShowAddFiles(true)
    } catch (e: any) {
      console.error("[v0] Apply plan error:", e)
      setLogs((prev) => [...prev, `❌ Erreur: ${e.message}`])
    } finally {
      setLoading(false)
    }
  }

  const combineWithStoredFiles = async (storedFiles: Record<string, string>, newPlan: GeminiPlan) => {
    const combinedPlan: GeminiPlan = {
      ...newPlan,
      files: {
        ...storedFiles,
        ...(newPlan.files || {}),
      },
    }

    await applyPlan(combinedPlan)
  }

  const navigateToRoute = () => {
    if (projectUrl && routeInput.trim()) {
      const route = routeInput.startsWith("/") ? routeInput : `/${routeInput}`
      return `${projectUrl}${route}`
    }
    return projectUrl
  }

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Configuration du projet</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Nom du projet (pour localStorage)"
              className="flex-1"
            />
            <Button onClick={() => setProjectName("")} variant="outline" disabled={!projectName}>
              Effacer
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Les fichiers seront sauvegardés dans localStorage avec ce nom
          </p>
        </CardContent>
      </Card>

      <Chat onApplyPlan={applyPlan} onRequestAnalysis={requestAnalysis} onCombineWithStored={combineWithStoredFiles} />

      {showAddFiles && currentSandboxId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Ajouter des fichiers au sandbox existant
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">Sandbox ID: {currentSandboxId}</p>
            <Chat
              onApplyPlan={combineWithStoredFiles.bind(null, {})}
              onRequestAnalysis={requestAnalysis}
              onCombineWithStored={combineWithStoredFiles}
            />
          </CardContent>
        </Card>
      )}

      <LocalStorageManager />

      <pre className="mt-4 p-4 bg-gray-100 rounded whitespace-pre-wrap">{logs.join("\n")}</pre>

      {url && (
        <div className="space-y-4">
          <p>
            🌐 Votre app Next.js est disponible ici :{" "}
            <a href={url} target="_blank" className="text-blue-600 underline" rel="noreferrer">
              {url}
            </a>
          </p>

          <div className="border p-4 rounded">
            <h3 className="text-lg font-semibold mb-2">📱 Aperçu du Projet</h3>
            <div className="flex gap-2 mb-4">
              <Input
                value={routeInput}
                onChange={(e) => setRouteInput(e.target.value)}
                placeholder="Entrez une route (ex: /about, /contact)"
                className="flex-1"
              />
              <Button
                onClick={() => {
                  const iframe = document.getElementById("project-iframe") as HTMLIFrameElement
                  if (iframe) {
                    iframe.src = navigateToRoute() || projectUrl || ""
                  }
                }}
              >
                Naviguer
              </Button>
            </div>
            <iframe
              id="project-iframe"
              src={projectUrl || ""}
              className="w-full h-96 border rounded"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        </div>
      )}
    </div>
  )
}
