// Google By WillZek >> https://github.com/WillZek

import fetch from 'node-fetch';

let MF = async(m, { conn, usedPrefix, command, args }) => {

if (!args[0]) return m.reply('🌃 Ingrese Para Buscar En Google');

let moon = args[0];
let force = `https://api.siputzx.my.id/api/tools/ssweb?url=https://www.google.com/search?q=${moon}`;

let txt = `*Resultados De: ${args[0]}`;

conn.sendMessage(m.chat, { image: { url: force }, caption: txt }, { quoted: m });
}

MF.command = ['google'];

export default MF;