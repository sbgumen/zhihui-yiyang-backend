const express = require('express')
const pool = require('../config/db')
const bcrypt = require('bcrypt')
const { authMiddleware } = require('../middleware/auth')

const router = express.Router()

const USER_FIELDS = 'id, user_id, account, phone, nickname, gender, avatar, balance, created_at, (password IS NOT NULL) as hasPassword'

// 获取用户信息
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT ${USER_FIELDS} FROM users WHERE id = ?`,
      [req.user.id]
    )

    if (users.length === 0) {
      return res.status(404).json({ code: 404, message: '用户不存在' })
    }

    const user = users[0]
    user.balance = parseFloat(user.balance)
    res.json({ code: 200, data: user })
  } catch (err) {
    console.error('获取用户信息失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 更新用户信息
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { nickname, gender, avatar } = req.body
    const updates = []
    const values = []

    if (nickname !== undefined) {
      updates.push('nickname = ?')
      values.push(nickname)
    }
    if (gender !== undefined) {
      updates.push('gender = ?')
      values.push(gender)
    }
    if (avatar !== undefined) {
      updates.push('avatar = ?')
      values.push(avatar)
    }

    if (updates.length === 0) {
      return res.status(400).json({ code: 400, message: '没有需要更新的字段' })
    }

    values.push(req.user.id)
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values)

    const [users] = await pool.execute(
      `SELECT ${USER_FIELDS} FROM users WHERE id = ?`,
      [req.user.id]
    )

    const user = users[0]
    user.balance = parseFloat(user.balance)
    res.json({ code: 200, message: '更新成功', data: user })
  } catch (err) {
    console.error('更新用户信息失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 充值
router.post('/recharge', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body

    if (!amount || amount <= 0) {
      return res.status(400).json({ code: 400, message: '充值金额无效' })
    }

    await pool.execute(
      'UPDATE users SET balance = balance + ? WHERE id = ?',
      [amount, req.user.id]
    )

    const [users] = await pool.execute(
      `SELECT ${USER_FIELDS} FROM users WHERE id = ?`,
      [req.user.id]
    )

    const user = users[0]
    user.balance = parseFloat(user.balance)
    res.json({ code: 200, message: '充值成功', data: user })
  } catch (err) {
    console.error('充值失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

// 修改密码
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ code: 400, message: '新密码至少6位' })
    }

    const [users] = await pool.execute('SELECT password FROM users WHERE id = ?', [req.user.id])
    if (users.length === 0) {
      return res.status(404).json({ code: 404, message: '用户不存在' })
    }

    // 已有密码时需验证旧密码
    if (users[0].password) {
      if (!oldPassword) {
        return res.status(400).json({ code: 400, message: '请输入原密码' })
      }
      const match = await bcrypt.compare(oldPassword, users[0].password)
      if (!match) {
        return res.status(400).json({ code: 400, message: '当前密码不正确' })
      }
    }

    const hashed = await bcrypt.hash(newPassword, 10)
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id])
    res.json({ code: 200, message: '密码设置成功' })
  } catch (err) {
    console.error('修改密码失败:', err)
    res.status(500).json({ code: 500, message: '服务器错误' })
  }
})

module.exports = router
