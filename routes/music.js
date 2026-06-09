// 网易云音乐 API 代理路由
const express = require('express')
const router = express.Router()
const api = require('NeteaseCloudMusicApi')
const qrcode = require('qrcode')
const fs = require('fs')
const path = require('path')

// ============ Cookie 持久化 ============
const ENV_PATH = path.join(__dirname, '..', '.env')

function readEnvCookie() {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8')
    // 取最后一条非空值，避免读到空行
    const matches = content.match(/MUSIC_U_COOKIE=(.+)/g)
    if (!matches) return ''
    const last = matches[matches.length - 1]
    const val = last.replace('MUSIC_U_COOKIE=', '').trim()
    return val || ''
  } catch { return '' }
}

function saveEnvCookie(cookie) {
  try {
    let content = fs.readFileSync(ENV_PATH, 'utf-8')
    if (content.match(/MUSIC_U_COOKIE=.+/)) {
      content = content.replace(/MUSIC_U_COOKIE=.*(\r?\n|$)/g, 'MUSIC_U_COOKIE=' + cookie + '\n')
    } else {
      content += '\nMUSIC_U_COOKIE=' + cookie + '\n'
    }
    fs.writeFileSync(ENV_PATH, content, 'utf-8')
    console.log('[Cookie] 已保存到 .env')
  } catch (e) {
    console.error('[Cookie] 写入失败:', e.message)
  }
}

// 全局共享 Cookie（所有用户共用）
let sharedCookie = readEnvCookie()
let sharedUser = {}

// 给 API 调用注入 Cookie
function callWithCookie(fn, params = {}) {
  return fn({ ...params, cookie: sharedCookie })
}

// ============ 登录（管理员扫码，一次即可）============

// 生成二维码
router.get('/login/qr/create', async (req, res) => {
  try {
    const keyRes = await api.login_qr_key()
    const key = keyRes.body?.data?.unikey
    if (!key) return res.status(500).json({ error: '获取key失败' })

    const qrRes = await api.login_qr_create({ key, qrimg: true })
    if (!qrRes.body?.data?.qrurl) return res.status(500).json({ error: '获取二维码失败' })

    const qrImg = await qrcode.toDataURL(qrRes.body.data.qrurl, { width: 256, margin: 2 })
    res.json({ code: 200, qrimg: qrImg, key })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 轮询扫码状态
router.get('/login/qr/check', async (req, res) => {
  try {
    const result = await api.login_qr_check({ key: req.query.key })
    const code = result.body?.code

    if (code === 803) {
      sharedCookie = result.body.cookie || ''
      saveEnvCookie(sharedCookie)  // 持久化到 .env
      sharedUser = {}
      try {
        const acc = await api.user_account({ cookie: sharedCookie })
        if (acc.body?.profile) {
          sharedUser = {
            nickname: acc.body.profile.nickname,
            avatarUrl: acc.body.profile.avatarUrl
          }
        }
      } catch {}
      console.log('[登录成功]', sharedUser.nickname || '未知用户')
    }

    res.json({ code, message: result.body?.message || '' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// 获取登录状态
router.get('/login/status', (req, res) => {
  res.json({
    loggedIn: !!sharedCookie,
    user: sharedUser
  })
})

// 退出登录（清除共享 Cookie）
router.post('/login/logout', (req, res) => {
  sharedCookie = ''
  sharedUser = {}
  saveEnvCookie('')
  res.json({ code: 200 })
})

// ============ 音乐 API（自动注入共享 Cookie）============

// 搜索（自动补充专辑封面 picUrl）
router.get('/search', async (req, res) => {
  try {
    const result = await callWithCookie(api.search, {
      keywords: req.query.keywords, limit: req.query.limit || 30
    })
    const songs = result.body?.result?.songs || []
    // 搜索返回的是 picId，需要用 song/detail 获取真实 picUrl
    if (songs.length > 0) {
      const ids = songs.map(s => s.id).join(',')
      const detail = await callWithCookie(api.song_detail, { ids })
      const detailMap = {}
      ;(detail.body?.songs || []).forEach(s => {
        detailMap[s.id] = { picUrl: s.al?.picUrl || '', name: s.al?.name || '' }
      })
      songs.forEach(s => {
        if (detailMap[s.id]) {
          s.album = { ...s.album, picUrl: detailMap[s.id].picUrl, name: detailMap[s.id].name || s.album?.name }
        }
      })
    }
    res.json(result.body)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// 用户收藏的歌曲列表
router.get('/likelist', async (req, res) => {
  try {
    // 先获取用户 ID
    const acc = await callWithCookie(api.user_account)
    const uid = acc.body?.profile?.userId
    if (!uid) return res.json({ songs: [] })

    // 获取喜欢列表
    const result = await callWithCookie(api.likelist, { uid })
    const ids = result.body?.ids || []
    if (ids.length === 0) return res.json({ songs: [] })

    // 批量获取歌曲详情
    const detail = await callWithCookie(api.song_detail, { ids: ids.slice(0, 50).join(',') })
    const songs = (detail.body?.songs || []).map(s => ({
      id: s.id,
      name: s.name,
      artists: (s.ar || []).map(a => ({ name: a.name })),
      album: { picUrl: s.al?.picUrl || '', name: s.al?.name || '' },
      duration: s.dt || 0,
      fee: s.fee || 0
    }))
    res.json({ songs })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/song/url', async (req, res) => {
  try {
    const result = await callWithCookie(api.song_url_v1, {
      id: req.query.id, level: req.query.level || 'standard'
    })
    res.json(result.body)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/lyric', async (req, res) => {
  try {
    const result = await callWithCookie(api.lyric_new, { id: req.query.id })
    res.json(result.body)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/audio/:id', async (req, res) => {
  try {
    const urlRes = await callWithCookie(api.song_url_v1, {
      id: req.params.id, level: req.query.level || 'standard'
    })
    const audioUrl = urlRes.body?.data?.[0]?.url
    if (!audioUrl) return res.status(404).json({ error: '无播放地址' })

    const http = require('http')
    const https = require('https')
    const client = audioUrl.startsWith('https') ? https : http
    client.get(audioUrl, (audioRes) => {
      if (audioRes.statusCode !== 200) return res.status(403).json({ error: '音频请求失败' })
      res.set({
        'Content-Type': audioRes.headers['content-type'] || 'audio/mpeg',
        'Content-Length': audioRes.headers['content-length'],
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600'
      })
      audioRes.pipe(res)
    }).on('error', () => res.status(500).json({ error: '音频获取失败' }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/image', async (req, res) => {
  try {
    const url = req.query.url
    if (!url) return res.status(400).json({ error: '缺少 url 参数' })
    const decoded = decodeURIComponent(url)
    const http = require('http')
    const https = require('https')
    const client = decoded.startsWith('https') ? https : http
    client.get(decoded, (imgRes) => {
      if (imgRes.statusCode !== 200) return res.status(404).json({ error: '图片获取失败' })
      res.set({
        'Content-Type': imgRes.headers['content-type'] || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400'
      })
      imgRes.pipe(res)
    }).on('error', () => res.status(500).json({ error: '图片获取失败' }))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/playlist', async (req, res) => {
  try {
    const result = await callWithCookie(api.playlist_detail, { id: req.query.id })
    res.json(result.body)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/playlist/hot', async (req, res) => {
  try {
    const result = await callWithCookie(api.top_playlist, { order: 'hot', limit: 10 })
    res.json(result.body)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.get('/song/detail', async (req, res) => {
  try {
    const result = await callWithCookie(api.song_detail, { ids: req.query.ids })
    res.json(result.body)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
