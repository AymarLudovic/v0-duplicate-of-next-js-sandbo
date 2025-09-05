import { NextResponse } from "next/server"
import { JSDOM } from "jsdom"

async function fetchUrlContent(url: string): Promise<{ success: boolean; content: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    })

    if (!response.ok) {
      throw new Error(`La requête a échoué avec le statut: ${response.status}`)
    }

    const content = await response.text()
    return { success: true, content }
  } catch (error) {
    console.error(`Erreur lors du fetch de ${url}:`, error)
    return { success: false, content: "" }
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    let urlToAnalyze = body.url as string

    if (!urlToAnalyze) {
      return NextResponse.json({ error: "L'URL est manquante." }, { status: 400 })
    }

    if (!/^https?:\/\//i.test(urlToAnalyze)) {
      urlToAnalyze = "https://" + urlToAnalyze
    }

    const mainResponse = await fetchUrlContent(urlToAnalyze)
    if (!mainResponse.success) {
      throw new Error("Impossible de récupérer le contenu HTML principal du site.")
    }

    const dom = new JSDOM(mainResponse.content)
    const document = dom.window.document
    const baseURL = new URL(urlToAnalyze).origin

    const cssSources = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
      (el) => new URL((el as HTMLLinkElement).href, baseURL).href,
    )

    const cssFetches = await Promise.all(cssSources.map((href) => fetchUrlContent(href)))
    const inlineCss = Array.from(document.querySelectorAll("style")).map((s) => s.textContent || "")
    const fullCSS = [...cssFetches.filter((c) => c.success).map((c) => c.content), ...inlineCss].join("\n\n")

    const scriptSources = Array.from(document.querySelectorAll("script[src]")).map(
      (el) => new URL((el as HTMLScriptElement).src, baseURL).href,
    )

    const scriptFetches = await Promise.all(scriptSources.map((src) => fetchUrlContent(src)))
    const inlineJs = Array.from(document.querySelectorAll("script:not([src])")).map((s) => s.textContent || "")
    const fullJS = [...scriptFetches.filter((s) => s.success).map((s) => s.content), ...inlineJs].join("\n\n")

    const fullHTML = document.body.innerHTML

    return NextResponse.json({
      fullHTML,
      fullCSS,
      fullJS,
      baseURL,
    })
  } catch (err: any) {
    console.error("Erreur dans l'API d'analyse:", err)
    return NextResponse.json({ error: `L'analyse a échoué: ${err.message}` }, { status: 500 })
  }
}
