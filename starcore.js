process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '1'

import './config.js'
import { createRequire } from 'module'
import path, { join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { platform } from 'process'
import fs from 'fs'
import yargs from 'yargs'
import lodash from 'lodash'
import chalk from 'chalk'
import pino from 'pino'
import { makeWASocket, protoType, serialize } from './lib/simple.js'
import { Low, JSONFile } from 'lowdb'
import store from './lib/store.js'
import qrcode from 'qrcode-terminal'
import readline from 'readline'
import NodeCache from 'node-cache'

const {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser
} = await import('@whiskeysockets/baileys')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (texto) => new Promise((resolver) => rl.question(texto, resolver))

// Globals
global.__filename = function (pathURL = import.meta.url, rmPrefix = platform !== 'win32') {
  return rmPrefix ? fileURLToPath(pathURL) : pathToFileURL(pathURL).toString()
}
global.__dirname = function (pathURL) {
  return path.dirname(global.__filename(pathURL, true))
}
global.__require = function (dir = import.meta.url) {
  return createRequire(dir)
}

const __dirname = global.__dirname(import.meta.url)
global.opts = yargs(process.argv.slice(2)).exitProcess(false).parse()
global.prefix = new RegExp('^[' + (opts['prefix'] || '‎z/#$%.\\-').replace(/[|\\{}()[\]^$+*?.\-\^]/g, '\\$&') + ']')

global.db = new Low(new JSONFile(`${opts._[0] ? opts._[0] + '_' : ''}database.json`))
global.DATABASE = global.db

global.loadDatabase = async function () {
  if (global.db.READ) return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!global.db.READ) {
        clearInterval(interval)
        resolve(global.db.data || {})
      }
    }, 1000)
  })
  if (global.db.data !== null) return
  global.db.READ = true
  await global.db.read().catch(console.error)
  global.db.READ = null
  global.db.data ||= {
    users: {},
    chats: {},
    stats: {},
    msgs: {},
    sticker: {},
    settings: {}
  }
  global.db.chain = lodash.chain(global.db.data)
}
await loadDatabase()

// Auth
global.authFile = 'sessions'
const { state, saveCreds } = await useMultiFileAuthState(global.authFile)
const msgRetryCounterCache = new NodeCache()
const { version } = await fetchLatestBaileysVersion()

// Opción de conexión
let opcion = '1'
if (!fs.existsSync(`./${authFile}/creds.json`) && !process.argv.includes('qr')) {
  do {
    opcion = await question('Seleccione una opción:\n1. Con código QR\n2. Con código de texto (NO DISPONIBLE)\n---> ')
    if (!['1'].includes(opcion)) console.log('Opción inválida. Seleccione solo 1.\n')
  } while (!['1'].includes(opcion))
}

protoType()
serialize()

// Conexión
const connectionOptions = {
  logger: pino({ level: 'silent' }),
  browser: ['Sonic Bot', 'Safari', '2.0.0'],
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
  },
  msgRetryCounterCache,
  generateHighQualityLinkPreview: true,
  markOnlineOnConnect: true,
  getMessage: async (key) => {
    const jid = jidNormalizedUser(key.remoteJid)
    const msg = await store.loadMessage(jid, key.id)
    return msg?.message || ''
  },
  version
}

let conn
global.plugins = {}
const pluginFolder = path.join(__dirname, 'plugins')

const loadPlugins = async () => {
  const files = fs.readdirSync(pluginFolder).filter(file => file.endsWith('.js'))
  for (const file of files) {
    try {
      const pluginPath = pathToFileURL(path.join(pluginFolder, file)).href + '?update=' + Date.now()
      const module = await import(pluginPath)
      global.plugins[file] = module.default || module
      console.log(chalk.green(`[PLUGIN] Cargado: ${file}`))
    } catch (e) {
      console.error(chalk.red(`[PLUGIN ERROR] ${file}:`), e)
    }
  }
}

async function startConnection() {
  conn = makeWASocket(connectionOptions)

  conn.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      console.log(chalk.cyan('Escanea este código QR con WhatsApp:\n'))
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      console.log(chalk.red(`Conexión cerrada: ${lastDisconnect?.error?.message || statusCode}`))
      if (shouldReconnect) {
        console.log(chalk.yellow('Reconectando...'))
        startConnection()
      } else {
        console.log(chalk.red('Sesión cerrada. Inicie sesión nuevamente.'))
        process.exit(0)
      }
    }
    if (connection === 'open') {
      console.log(chalk.green('✅ Conexión establecida correctamente.'))
    }
  })

  conn.ev.on('creds.update', saveCreds)

  // 🔌 Procesar comandos de plugins
  conn.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || ''
    const prefixMatch = text.match(global.prefix)
    if (!prefixMatch) return

    const body = text.slice(prefixMatch[0].length).trim()
    const [cmd, ...args] = body.split(/\s+/)
    const command = cmd.toLowerCase()

    for (const pluginName in global.plugins) {
      const plugin = global.plugins[pluginName]
      try {
        if (typeof plugin === 'function') {
          await plugin({ conn, msg, command, args, text: body })
        }
      } catch (e) {
        console.error(chalk.red(`[PLUGIN ERROR] ${pluginName}:`), e)
      }
    }
  })

  await loadPlugins()
  return conn
}

startConnection()
export default conn