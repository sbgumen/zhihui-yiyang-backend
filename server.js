require('dotenv').config()
const express = require('express')
const cors = require('cors')
const pool = require('./config/db')
const authRoutes = require('./routes/auth')
const userRoutes = require('./routes/user')
const orderRoutes = require('./routes/order')
const musicRoutes = require('./routes/music')

const app = express()
const PORT = 4001

// 中间件
app.use(cors())
app.use(express.json())

// 路由
app.use('/api/auth', authRoutes)
app.use('/api/user', userRoutes)
app.use('/api/order', orderRoutes)
app.use('/api/music', musicRoutes)

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ code: 200, message: '服务运行正常' })
})

// 启动时自动建表
async function initDatabase() {
  try {
    // 先建表（新安装）
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(10) UNIQUE,
        account VARCHAR(50) UNIQUE,
        phone VARCHAR(20) UNIQUE,
        password VARCHAR(255) DEFAULT NULL,
        nickname VARCHAR(50) DEFAULT '',
        gender ENUM('male', 'female', 'unknown') DEFAULT 'unknown',
        avatar VARCHAR(500) DEFAULT '',
        balance DECIMAL(10,2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    // 迁移旧表：添加新字段（忽略已存在的错误）
    const alterColumns = [
      "ALTER TABLE users ADD COLUMN user_id VARCHAR(10) UNIQUE",
      "ALTER TABLE users ADD COLUMN phone VARCHAR(20) UNIQUE",
      "ALTER TABLE users MODIFY COLUMN password VARCHAR(255) DEFAULT NULL",
      "ALTER TABLE users MODIFY COLUMN account VARCHAR(50) NULL",
    ]
    for (const sql of alterColumns) {
      try { await pool.execute(sql) } catch {}
    }
    // 为旧用户补充 user_id（此时字段已确保存在）
    const [noId] = await pool.execute("SELECT id FROM users WHERE user_id IS NULL")
    for (const row of noId) {
      let uid, exists
      do {
        uid = String(Math.floor(10000 + Math.random() * 90000))
        const [r] = await pool.execute('SELECT id FROM users WHERE user_id = ?', [uid])
        exists = r.length > 0
      } while (exists)
      await pool.execute('UPDATE users SET user_id = ? WHERE id = ?', [uid, row.id])
    }
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS sms_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(20) NOT NULL,
        code VARCHAR(10) NOT NULL,
        expires_at BIGINT NOT NULL,
        used TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_no VARCHAR(50) UNIQUE NOT NULL,
        user_id INT NOT NULL,
        items TEXT NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        status ENUM('pending', 'confirmed', 'cancelled') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('数据库表初始化完成')
  } catch (err) {
    console.error('数据库初始化失败:', err.message)
    process.exit(1)
  }
}

initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`智绘颐养后端服务已启动: http://0.0.0.0:${PORT}`)
  })
})
