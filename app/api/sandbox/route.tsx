import { NextResponse } from "next/server"
import * as e2b from "@e2b/code-interpreter"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch((e) => {
      console.error("[v0] Failed to parse request JSON:", e)
      throw new Error("Invalid JSON in request body")
    })

    const { action, sandboxId: bodySandboxId, plan } = body || {}

    const apiKey = process.env.E2B_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "E2B_API_KEY manquant" }, { status: 500 })
    }

    console.log("[v0] Sandbox API called with action:", action)

    switch (action) {
      case "create": {
        console.log("[v0] Creating new sandbox...")
        const sandbox = await e2b.Sandbox.create({
          apiKey,
          timeoutMs: 120000, // 2 minutes
        })

        // Create default Next.js structure
        const defaultPackageJson = {
          name: "nextjs-app",
          private: true,
          scripts: {
            dev: "next dev -p 3000 -H 0.0.0.0",
            build: "next build",
            start: "next start -p 3000 -H 0.0.0.0",
          },
          dependencies: {
            next: "14.2.3",
            react: "18.2.0",
            "react-dom": "18.2.0",
          },
        }

        await sandbox.files.write("/home/user/package.json", JSON.stringify(defaultPackageJson, null, 2))

        await sandbox.files.write(
          "/home/user/app/layout.tsx",
          `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}`.trim(),
        )

        await sandbox.files.write(
          "/home/user/app/page.tsx",
          `"use client";
export default function Page() {
  return <h1>🚀 Hello depuis Next.js dans E2B</h1>;
}`.trim(),
        )

        console.log("[v0] Default Next.js structure created")
        return NextResponse.json({ sandboxId: sandbox.sandboxId })
      }

      case "applyPlan": {
        console.log("[v0] Applying plan to sandbox...")
        console.log("[v0] Plan received:", JSON.stringify(plan, null, 2))

        let sid: string | null = bodySandboxId || null
        let sandbox: e2b.Sandbox

        if (!sid) {
          console.log("[v0] No sandbox ID provided, creating new sandbox...")
          sandbox = await e2b.Sandbox.create({
            apiKey,
            timeoutMs: 120000,
          })
          sid = sandbox.sandboxId
        } else {
          console.log("[v0] Connecting to existing sandbox:", sid)
          sandbox = await e2b.Sandbox.connect(sid, {
            apiKey,
            timeoutMs: 60000,
          })
        }

        let existingGlobalsCss = false
        try {
          await sandbox.files.read("/home/user/app/globals.css")
          existingGlobalsCss = true
          console.log("[v0] 🎨 Fichier globals.css détecté - fichier de l'IA non pris en charge")
        } catch (e) {
          console.log("[v0] No existing globals.css found")
        }

        // Create package.json with dependencies
        const hasCustomDeps = plan?.dependencies && Object.keys(plan.dependencies).length > 0
        const hasCustomDevDeps = plan?.devDependencies && Object.keys(plan.devDependencies).length > 0

        const packageJson = {
          name: "nextjs-app",
          private: true,
          scripts: {
            dev: "next dev -p 3000 -H 0.0.0.0",
            build: "next build",
            start: "next start -p 3000 -H 0.0.0.0",
          },
          dependencies: {
            next: "14.2.3",
            react: "18.2.0",
            "react-dom": "18.2.0",
            ...(hasCustomDeps ? plan.dependencies : {}),
          },
          ...(hasCustomDevDeps && { devDependencies: plan.devDependencies }),
        }

        console.log("[v0] Writing package.json:", JSON.stringify(packageJson, null, 2))
        await sandbox.files.write("/home/user/package.json", JSON.stringify(packageJson, null, 2))

        // Write default layout if not provided
        if (!plan?.files?.["app/layout.tsx"]) {
          console.log("[v0] Writing default layout.tsx")
          await sandbox.files.write(
            "/home/user/app/layout.tsx",
            `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}`.trim(),
          )
        }

        // Delete files marked for deletion
        if (Array.isArray(plan?.delete)) {
          for (const p of plan.delete) {
            try {
              console.log("[v0] Deleting file:", p)
              await sandbox.files.delete(`/home/user/${p}`)
            } catch (e) {
              console.log("[v0] Could not delete file:", p, e)
            }
          }
        }

        const filteredFiles = plan?.files || {}
        if (existingGlobalsCss && filteredFiles["app/globals.css"]) {
          console.log("[v0] ⚠️ Fichier globals.css de l'IA ignoré - utilisation du fichier existant")
          delete filteredFiles["app/globals.css"]
        }

        // Write all files from the plan (except filtered ones)
        if (filteredFiles && Object.keys(filteredFiles).length > 0) {
          console.log("[v0] Writing AI-generated files...")
          for (const [path, content] of Object.entries(filteredFiles)) {
            console.log("[v0] Writing file:", path)
            await sandbox.files.write(`/home/user/${path}`, String(content))
          }
          console.log("[v0] All AI files written successfully")
        }

        return NextResponse.json({
          success: true,
          sandboxId: sid,
          message: "Plan applied successfully",
          filesWritten: filteredFiles ? Object.keys(filteredFiles).length : 0,
        })
      }

      case "install": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        console.log("[v0] Installing dependencies for sandbox:", sid)
        const sandbox = await e2b.Sandbox.connect(sid, {
          apiKey,
          timeoutMs: 60000,
        })

        const { stdout, stderr } = await sandbox.commands.run("npm install --no-audit --loglevel warn", {
          cwd: "/home/user",
          timeoutMs: 300000, // 5 minutes for npm install
        })

        console.log("[v0] Install completed")
        return NextResponse.json({ success: true, logs: stdout + stderr })
      }

      case "build": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        console.log("[v0] Building project for sandbox:", sid)
        const sandbox = await e2b.Sandbox.connect(sid, {
          apiKey,
          timeoutMs: 60000,
        })

        const { stdout, stderr } = await sandbox.commands.run("npm run build", {
          cwd: "/home/user",
          timeoutMs: 180000, // 3 minutes for build
        })

        console.log("[v0] Build completed")
        return NextResponse.json({ success: true, logs: stdout + stderr })
      }

      case "start": {
        const sid = bodySandboxId
        if (!sid) throw new Error("sandboxId manquant")

        console.log("[v0] Starting server for sandbox:", sid)
        const sandbox = await e2b.Sandbox.connect(sid, {
          apiKey,
          timeoutMs: 60000,
        })

        // Start server asynchronously
        sandbox.commands.start("npm run start", { cwd: "/home/user" })

        const url = `https://${sandbox.getHost(3000)}`
        console.log("[v0] Server started at:", url)

        return NextResponse.json({ success: true, url })
      }

      default:
        return NextResponse.json({ error: "Action inconnue" }, { status: 400 })
    }
  } catch (e: any) {
    console.error("[v0] Sandbox API error:", e)
    return NextResponse.json(
      {
        error: e.message || "Une erreur inconnue s'est produite",
        details: e.toString(),
      },
      { status: 500 },
    )
  }
}
