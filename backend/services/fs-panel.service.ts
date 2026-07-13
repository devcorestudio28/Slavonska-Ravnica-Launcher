import axios, { type AxiosResponse } from 'axios'
import type { GameServer, FsPanelMod, FsPanelState } from '../../src/shared/types'
import { sanitizeHost } from './net-util'

type PanelAction = 'start' | 'stop' | 'restart'

interface HtmlInput {
  name: string
  value: string
  type: string
  id: string
  checked: boolean
  html: string
}

interface HtmlForm {
  action: string
  method: string
  body: string
  inputs: HtmlInput[]
}

interface PanelSession {
  baseUrl: string
  cookie: string
}

/**
 * Controls the official GIANTS dedicated-server web interface. GIANTS does not
 * expose these mutations through its read-only Web API feed, so we authenticate
 * as a dedicated low-privilege web user and submit the same HTML forms as the UI.
 */
export class FsPanelService {
  async getState(server: GameServer): Promise<FsPanelState> {
    if (!this.isConfigured(server)) return { configured: false, status: 'unknown', mods: [] }

    const session = await this.login(server)
    const [indexHtml, modsHtml] = await Promise.all([
      this.get(session, '/index.html?lang=en'),
      this.get(session, '/mods.html?lang=en')
    ])

    return {
      configured: true,
      status: this.readStatus(indexHtml),
      mods: this.readMods(modsHtml)
    }
  }

  async executeAction(server: GameServer, action: PanelAction): Promise<void> {
    const session = await this.login(server)
    const path = '/index.html?lang=en'
    const html = await this.get(session, path)
    const form = this.findActionForm(html, action)
    if (!form) throw new Error(`GIANTS panel nema dostupnu akciju: ${action}`)

    await this.submitForm(session, path, form, (input) => {
      if (input.type !== 'submit') return input.type !== 'checkbox' && input.type !== 'radio' || input.checked
      return this.matchesAction(input, action)
    })
  }

  async saveActiveMods(server: GameServer, activeModIds: string[]): Promise<void> {
    const session = await this.login(server)
    const path = '/mods.html?lang=en'
    const html = await this.get(session, path)
    const form = this.findModForm(html)
    if (!form) throw new Error('GIANTS panel nije vratio obrazac za aktivaciju modova')

    const desired = new Set(activeModIds)
    const modInputs = this.modInputs(form)
    const modIds = new Map(modInputs.map((input) => [input.html, this.modId(input)]))
    const saveButton = form.inputs.find((input) =>
      input.type === 'submit' && /save|activate|apply|speichern|aktivieren/i.test(`${input.name} ${input.value}`)
    ) ?? form.inputs.find((input) => input.type === 'submit')

    await this.submitForm(session, path, form, (input) => {
      if (input.type === 'submit') return input === saveButton
      if (input.type === 'checkbox' && modIds.has(input.html)) return desired.has(modIds.get(input.html) as string)
      if (input.type === 'checkbox' || input.type === 'radio') return input.checked
      return true
    })
  }

  private isConfigured(server: GameServer): boolean {
    return !!(server.webAdminUsername?.trim() && server.webAdminPassword)
  }

  private baseUrl(server: GameServer): string {
    const host = server.ip || sanitizeHost(server.ftpHost)
    if (!host) throw new Error('IP adresa FS web panela nije konfigurirana')
    const port = Number(server.webStatsPort || 8080)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Neispravan port FS web panela')
    return `http://${host}:${port}`
  }

  private async login(server: GameServer): Promise<PanelSession> {
    if (!this.isConfigured(server)) {
      throw new Error('Uredi server i unesi Panel korisnika i Panel lozinku')
    }

    const baseUrl = this.baseUrl(server)
    const body = new URLSearchParams({
      username: server.webAdminUsername?.trim() || '',
      password: server.webAdminPassword || '',
      login: 'Login'
    })
    const response = await axios.post<string>(`${baseUrl}/index.html?lang=en`, body.toString(), {
      timeout: 12000,
      responseType: 'text',
      transformResponse: [(data) => data],
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
    const cookie = this.readCookie(response)
    if (!cookie) throw new Error('GIANTS panel nije prihvatio prijavu (nema session cookieja)')

    const session = { baseUrl, cookie }
    const html = response.status >= 300
      ? await this.get(session, response.headers.location || '/index.html?lang=en')
      : String(response.data)
    if (this.isLoginPage(html)) throw new Error('Neispravno korisničko ime ili lozinka GIANTS panela')
    return session
  }

  private readCookie(response: AxiosResponse): string {
    const cookies = response.headers['set-cookie']
    return Array.isArray(cookies) ? cookies.map((cookie) => cookie.split(';')[0]).join('; ') : ''
  }

  private async get(session: PanelSession, path: string): Promise<string> {
    const url = new URL(path, `${session.baseUrl}/`).toString()
    const response = await axios.get<string>(url, {
      timeout: 12000,
      responseType: 'text',
      transformResponse: [(data) => data],
      headers: { Cookie: session.cookie }
    })
    const html = String(response.data)
    if (this.isLoginPage(html)) throw new Error('GIANTS panel sesija je odbijena')
    return html
  }

  private async submitForm(
    session: PanelSession,
    currentPath: string,
    form: HtmlForm,
    include: (input: HtmlInput) => boolean
  ): Promise<void> {
    const body = new URLSearchParams()
    for (const input of form.inputs) {
      if (input.name && include(input)) body.append(input.name, input.value)
    }
    const target = new URL(form.action || currentPath, `${session.baseUrl}${currentPath}`).toString()
    const response = await axios.request<string>({
      method: form.method === 'get' ? 'GET' : 'POST',
      url: target,
      params: form.method === 'get' ? body : undefined,
      data: form.method === 'get' ? undefined : body.toString(),
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        Cookie: session.cookie,
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: new URL(currentPath, `${session.baseUrl}/`).toString()
      }
    })
    if (response.status >= 400) throw new Error(`GIANTS panel je odbio zahtjev (${response.status})`)
  }

  private readStatus(html: string): FsPanelState['status'] {
    if (this.findActionForm(html, 'stop') || this.findActionForm(html, 'restart')) return 'running'
    if (this.findActionForm(html, 'start')) return 'stopped'
    return 'unknown'
  }

  private findActionForm(html: string, action: PanelAction): HtmlForm | undefined {
    return this.parseForms(html).find((form) => form.inputs.some((input) =>
      input.type === 'submit' && this.matchesAction(input, action)
    ))
  }

  private matchesAction(input: HtmlInput, action: PanelAction): boolean {
    const haystack = `${input.name} ${input.value}`.toLowerCase()
    const patterns: Record<PanelAction, RegExp> = {
      start: /\b(start|serverstart|pokreni|starten)\b/i,
      stop: /\b(stop|serverstop|zaustavi|stopp)\b/i,
      restart: /\b(restart|serverrestart|ponovno|neustart)\b/i
    }
    return patterns[action].test(haystack)
  }

  private readMods(html: string): FsPanelMod[] {
    const form = this.findModForm(html)
    if (!form) return []
    return this.modInputs(form).map((input) => ({
      id: this.modId(input),
      name: this.modName(form.body, input),
      active: input.checked
    })).sort((a, b) => a.name.localeCompare(b.name))
  }

  private findModForm(html: string): HtmlForm | undefined {
    return this.parseForms(html)
      .map((form) => ({ form, score: this.modInputs(form).length }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.form
  }

  private modInputs(form: HtmlForm): HtmlInput[] {
    const checkboxes = form.inputs.filter((input) => input.type === 'checkbox' && input.name)
    const likely = checkboxes.filter((input) => /mod/i.test(`${input.name} ${input.id} ${input.html}`))
    return likely.length ? likely : checkboxes
  }

  private modId(input: HtmlInput): string {
    return `${encodeURIComponent(input.name)}|${encodeURIComponent(input.value)}`
  }

  private modName(formBody: string, input: HtmlInput): string {
    if (/\.zip$/i.test(input.value)) return decodeHtml(input.value)
    if (input.id) {
      const escaped = escapeRegExp(input.id)
      const label = formBody.match(new RegExp(`<label\\b[^>]*for=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/label>`, 'i'))?.[1]
      if (label) return stripHtml(label)
    }
    const title = attr(input.html, 'title')
    return decodeHtml(title || input.value || input.name)
  }

  private parseForms(html: string): HtmlForm[] {
    const forms: HtmlForm[] = []
    for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      const formAttrs = match[1]
      const body = match[2]
      const inputs: HtmlInput[] = []
      for (const inputMatch of body.matchAll(/<input\b([^>]*)>/gi)) {
        const raw = inputMatch[0]
        inputs.push({
          name: decodeHtml(attr(raw, 'name') || ''),
          value: decodeHtml(attr(raw, 'value') || ''),
          type: (attr(raw, 'type') || 'text').toLowerCase(),
          id: decodeHtml(attr(raw, 'id') || ''),
          checked: /\bchecked(?:\s*=|\s|>)/i.test(raw),
          html: raw
        })
      }
      for (const buttonMatch of body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
        const raw = buttonMatch[0]
        inputs.push({
          name: decodeHtml(attr(raw, 'name') || ''),
          value: decodeHtml(attr(raw, 'value') || stripHtml(buttonMatch[2])),
          type: (attr(raw, 'type') || 'submit').toLowerCase(),
          id: decodeHtml(attr(raw, 'id') || ''),
          checked: false,
          html: raw
        })
      }
      forms.push({
        action: decodeHtml(attr(formAttrs, 'action') || ''),
        method: (attr(formAttrs, 'method') || 'get').toLowerCase(),
        body,
        inputs
      })
    }
    return forms
  }

  private isLoginPage(html: string): boolean {
    return /<input\b[^>]*name=["']username["']/i.test(html) && /<input\b[^>]*name=["']password["']/i.test(html)
  }
}

function attr(html: string, name: string): string | undefined {
  return html.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const fsPanelService = new FsPanelService()
