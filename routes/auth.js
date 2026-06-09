const express = require('express')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const pool = require('../config/db')
const { JWT_SECRET, authMiddleware } = require('../middleware/auth')

const router = express.Router()

// API 签名密钥（前后端共享）
const API_SIGN_KEY = process.env.API_SIGN_KEY || 'zhihui-yiyang-2024-api-sign'

// IP 频率限制存储
const rateLimitMap = new Map()

// 清理过期记录（每5分钟）
setInterval(() => {
  const now = Date.now()
  for (const [key, data] of rateLimitMap) {
    if (now - data.firstReq > 60000) rateLimitMap.delete(key)
  }
}, 300000)

// 频率限制中间件：同一IP每分钟最多5次
function smsRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress
  const now = Date.now()
  const record = rateLimitMap.get(ip)
  if (!record || now - record.firstReq > 60000) {
    rateLimitMap.set(ip, { firstReq: now, count: 1 })
    return next()
  }
  record.count++
  if (record.count > 5) {
    return res.status(429).json({ code: 429, message: '请求过于频繁，请稍后再试' })
  }
  next()
}

// 请求签名验证中间件
function verifySign(req, res, next) {
  const { _t, _sign } = req.body || {}
  if (!_t || !_sign) {
    return res.status(403).json({ code: 403, message: '非法请求' })
  }
  // 时间戳超过5分钟视为过期
  if (Math.abs(Date.now() - Number(_t)) > 300000) {
    return res.status(403).json({ code: 403, message: '请求已过期' })
  }
  // 验证 HMAC-SHA256 签名
  const expected = crypto.createHmac('sha256', API_SIGN_KEY).update(String(_t)).digest('hex').slice(0, 16)
  if (_sign === expected) return next()

  // Fallback: 验证简单哈希签名（HTTP 环境下 crypto.subtle 不可用时前端使用）
  const str = API_SIGN_KEY + String(_t)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  let fallbackSign = ''
  let seed = hash
  for (let i = 0; i < 4; i++) {
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b)
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b)
    seed = seed ^ (seed >>> 16)
    fallbackSign += (seed >>> 0).toString(16).padStart(8, '0')
  }
  fallbackSign = fallbackSign.slice(0, 16)
  if (_sign === fallbackSign) return next()

  return res.status(403).json({ code: 403, message: '签名验证失败' })
}

// 生成递增5位账号ID（从10000开始）
async function generateUserId() {
  const [rows] = await pool.execute("SELECT COUNT(*) as cnt FROM users")
  const nextId = 10000 + rows[0].cnt
  // 确保不重复
  const [exists] = await pool.execute('SELECT id FROM users WHERE user_id = ?', [String(nextId)])
  if (exists.length > 0) {
    // 如果冲突，找下一个可用的
    const [maxRow] = await pool.execute("SELECT MAX(CAST(user_id AS UNSIGNED)) as maxId FROM users WHERE user_id REGEXP '^[0-9]+$'")
    return String((maxRow[0].maxId || 9999) + 1)
  }
  return String(nextId)
}

// 发送短信验证码
router.post('/send-sms', smsRateLimit, verifySign, async (req, res) => {
  try {
    const { phone } = req.body
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
      return res.status(400).json({ code: 400, message: '请输入正确的手机号' })
    }

    // 60秒内不重复发送
    const [recent] = await pool.execute(
      'SELECT id FROM sms_codes WHERE phone = ? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND) AND used = 0',
      [phone]
    )
    if (recent.length > 0) {
      return res.status(400).json({ code: 400, message: '验证码已发送，请60秒后再试' })
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const expiresAt = Date.now() + 5 * 60 * 1000 // 5分钟有效

    // 存储验证码
    await pool.execute(
      'INSERT INTO sms_codes (phone, code, expires_at) VALUES (?, ?, ?)',
      [phone, code, expiresAt]
    )

    // 调用 spug.cc 推送短信
    const params = new URLSearchParams({ code, number: '1', targets: phone })
    const response = await fetch(`https://push.spug.cc/send/zk9qMjwx99rBRgQp?${params.toString()}`, {
      method: 'GET'
    })

    if (!response.ok) {
      console.error('短信发送失败:', await response.text())
      return res.status(500).json({ code: 500, message: '短信发送失败，请稍后重试' })
    }

    res.json({ code: 200, message: '验证码已发送' })
  } catch (err) {
    console.error('发送短信失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 手机号注册/登录（验证码）
router.post('/phone-login', async (req, res) => {
  try {
    const { phone, code, nickname } = req.body
    if (!phone || !code) {
      return res.status(400).json({ code: 400, message: '手机号和验证码不能为空' })
    }

    // 验证验证码
    const [codes] = await pool.execute(
      'SELECT id FROM sms_codes WHERE phone = ? AND code = ? AND expires_at > ? AND used = 0 ORDER BY id DESC LIMIT 1',
      [phone, code, Date.now()]
    )
    if (codes.length === 0) {
      return res.status(400).json({ code: 400, message: '验证码错误或已过期' })
    }

    // 标记验证码已使用
    await pool.execute('UPDATE sms_codes SET used = 1 WHERE id = ?', [codes[0].id])

    // 查找或创建用户
    const [users] = await pool.execute('SELECT * FROM users WHERE phone = ?', [phone])
    let user, isNew = false

    if (users.length > 0) {
      user = users[0]
    } else {
      // 新用户：生成5位账号ID
      const userId = await generateUserId()
      const defaultNickname = nickname || `用户${userId}`
      const [result] = await pool.execute(
        'INSERT INTO users (user_id, phone, nickname) VALUES (?, ?, ?)',
        [userId, phone, defaultNickname]
      )
      const [newUsers] = await pool.execute('SELECT * FROM users WHERE id = ?', [result.insertId])
      user = newUsers[0]
      isNew = true
    }

    const token = jwt.sign({ id: user.id, user_id: user.user_id }, JWT_SECRET, { expiresIn: '30d' })

    res.json({
      code: 200,
      message: isNew ? '注册成功' : '登录成功',
      data: {
        token,
        isNew,
        user: {
          id: user.id,
          user_id: user.user_id,
          account: user.account || user.user_id,
          phone: user.phone,
          nickname: user.nickname,
          gender: user.gender,
          avatar: user.avatar,
          balance: user.balance,
          hasPassword: !!user.password
        }
      }
    })
  } catch (err) {
    console.error('手机登录失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 账号密码登录（支持手机号或账号ID）
router.post('/login', async (req, res) => {
  try {
    const { account, password } = req.body
    if (!account || !password) {
      return res.status(400).json({ code: 400, message: '账号和密码不能为空' })
    }

    // 支持手机号、user_id、account 三种方式登录
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE account = ? OR phone = ? OR user_id = ?',
      [account, account, account]
    )
    if (users.length === 0) {
      return res.status(400).json({ code: 400, message: '账号或密码错误' })
    }

    const user = users[0]
    if (!user.password) {
      return res.status(400).json({ code: 400, message: '该账号未设置密码，请使用手机验证码登录' })
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return res.status(400).json({ code: 400, message: '账号或密码错误' })
    }

    const token = jwt.sign({ id: user.id, user_id: user.user_id }, JWT_SECRET, { expiresIn: '30d' })

    res.json({
      code: 200,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          user_id: user.user_id,
          account: user.account || user.user_id,
          phone: user.phone,
          nickname: user.nickname,
          gender: user.gender,
          avatar: user.avatar,
          balance: user.balance,
          hasPassword: !!user.password
        }
      }
    })
  } catch (err) {
    console.error('登录失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 旧版注册（兼容）
router.post('/register', async (req, res) => {
  try {
    const { account, password, nickname } = req.body
    if (!account || !password) {
      return res.status(400).json({ code: 400, message: '账号和密码不能为空' })
    }
    if (password.length < 6) {
      return res.status(400).json({ code: 400, message: '密码长度不能少于6位' })
    }
    const [existing] = await pool.execute('SELECT id FROM users WHERE account = ?', [account])
    if (existing.length > 0) {
      return res.status(400).json({ code: 400, message: '该账号已被注册' })
    }
    const userId = await generateUserId()
    const hashedPassword = await bcrypt.hash(password, 10)
    const [result] = await pool.execute(
      'INSERT INTO users (user_id, account, password, nickname) VALUES (?, ?, ?, ?)',
      [userId, account, hashedPassword, nickname || account]
    )
    const token = jwt.sign({ id: result.insertId, user_id: userId }, JWT_SECRET, { expiresIn: '30d' })
    res.json({
      code: 200,
      message: '注册成功',
      data: {
        token,
        user: { id: result.insertId, user_id: userId, account, nickname: nickname || account, gender: 'unknown', avatar: '', balance: 0, hasPassword: true }
      }
    })
  } catch (err) {
    console.error('注册失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 设置/修改密码（登录后）
router.post('/set-password', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ code: 400, message: '新密码不能少于6位' })
    }
    const [users] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id])
    const user = users[0]

    // 如果已有密码，需要验证旧密码
    if (user.password) {
      if (!oldPassword) {
        return res.status(400).json({ code: 400, message: '请输入原密码' })
      }
      const isValid = await bcrypt.compare(oldPassword, user.password)
      if (!isValid) {
        return res.status(400).json({ code: 400, message: '原密码错误' })
      }
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id])
    res.json({ code: 200, message: '密码设置成功' })
  } catch (err) {
    console.error('设置密码失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

module.exports = router
