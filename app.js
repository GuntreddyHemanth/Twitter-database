const express = require('express')
const app = express()
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
app.use(express.json())

const dbpath = path.join(__dirname, 'twitterClone.db')

let db

const initalizationData = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('server running in port 3000')
    })
  } catch (error) {
    console.log(`db Error : ${error.message}`)
    process.exit(1)
  }
}

initalizationData()

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const createUserCheck = `SELECT * FROM user WHERE username = '${username}';`
  const userdetails = await db.get(createUserCheck)
  if (userdetails) {
    response.send('User already exists')
  } else if (password.length < 6) {
    response.send('Password is too short')
  } else {
    const hashPassword = await bcrypt.hash(password, 10)
    const insertNewUser = `
       INSERT INTO 
            user(username, password, name, gender)
       VALUES(
            '${username}',
            '${hashPassword}',
            '${name}',
            '${gender}'
       );`
    await db.run(insertNewUser)
    response.send('User created successfully')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const createUserCheck = `SELECT * FROM user WHERE username='${username}';`
  const userCheck = await db.get(createUserCheck)
  if (!userCheck) {
    response.send('Invalid user')
  } else {
    const passwordCheck = await bcrypt.compare(password, userCheck.password)
    if (!passwordCheck) {
      response.send('Invalid password')
    } else {
      const payload = {username}
      const jwtToken = jwt.sign(payload, 'MY_SECRATE_KEY')
      response.send({jwtToken})
    }
  }
})

const authenticationCheck = (request, response, next) => {
  let jwtTokens
  const accessToken = request.headers['authorization']
  if (accessToken !== undefined) {
    jwtTokens = accessToken.split(' ')[1]
  }
  if (jwtTokens === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtTokens, 'MY_SECRATE_KEY', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

app.get(
  '/user/tweets/feed/',
  authenticationCheck,
  async (request, response) => {
    const {username} = request
    const selectedUsername = `SELECT * FROM user WHERE username = ?;`
    const userMark = await db.get(selectedUsername, [username])
    const userId = userMark.user_id

    const queryResult = `
    SELECT 
       user.username, tweet.tweet, tweet.date_time AS dateTime 
    FROM 
    follower INNER JOIN tweet
    ON follower.following_user_id = tweet.user_id 
    INNER JOIN user 
    ON tweet.user_id = user.user_id
    WHERE 
      follower.follower_user_id = ?
      ORDER BY 
      dateTime DESC
      LIMIT 4`

    const data = await db.all(queryResult, [userId])
    response.send(data)
  },
)

app.get('/user/following/', authenticationCheck, async (request, response) => {
  const {username} = request
  const selectedUsername = `SELECT * FROM user WHERE username = ?;`
  const userMark = await db.get(selectedUsername, [username])
  const userId = userMark.user_id
  const query = `
  SELECT name
  FROM follower INNER JOIN user
  ON follower.following_user_id = user.user_id
  WHERE follower_user_id = ?;`

  const data = await db.all(query, [userId])
  response.send(data)
})

app.get('/user/followers/', authenticationCheck, async (request, response) => {
  const {username} = request
  const selectedUsername = `SELECT * FROM user WHERE username= ?;`
  const userMark = await db.get(selectedUsername, [username])
  const userId = userMark.user_id
  const query = `
  SELECT name 
  FROM follower INNER JOIN user
  ON follower.follower_user_id = user.user_id
  WHERE following_user_id = ?;`
  const data = await db.all(query, [userId])
  response.send(data)
})

const userFollowingCheck = async (request, response, next) => {
  const {tweetId} = request.params
  const {username} = request
  const createUser = `SELECT * FROM user WHERE username= ?;`
  const dbUser = await db.get(createUser, [username])
  const dbuserId = dbUser.user_id

  const followingQuery = `SELECT following_user_id FROM follower WHERE follower_user_id = ?;`
  const followingUser = await db.all(followingQuery, [dbuserId])

  const twitterUserId = `SELECT * FROM tweet WHERE tweet_id = ?;`
  const twitterlist = await db.get(twitterUserId, [tweetId])
  if (!twitterlist) {
    response.status(400).send('Tweet not found')
    return
  }

  const twitterId = twitterlist.user_id

  let twitterUserIdForFollowingList = false
  followingUser.forEach(each => {
    if (each.following_user_id === twitterId) {
      twitterUserIdForFollowingList = true
    }
  })

  if (twitterUserIdForFollowingList) {
    next()
  } else {
    response.status(400)
    response.send('Invalid Request')
  }
}

app.get(
  '/tweets/:tweetId/',
  authenticationCheck,
  userFollowingCheck,
  async (request, response) => {
    const {tweetId} = request.params
    const query = `
  SELECT tweet, COUNT() AS replies, date_time AS dateTime
  FROM tweet INNER JOIN reply
  ON tweet.tweet_id = reply.tweet_id
  WHERE tweet.tweet_id = ?;`
    const data = await db.get(query, [tweetId])

    const likequery = `
  SELECT COUNT() AS likes
  FROM like WHERE tweet_id = ?;`
    const {likes} = await db.get(likequery, [tweetId])

    data.likes = likes
    response.send(data)
  },
)

app.get(
  '/tweets/:tweetId/likes/',
  authenticationCheck,
  userFollowingCheck,
  async (request, response) => {
    const {tweetId} = request.params
    const queryreq = `
  SELECT username 
  FROM like NATURAL JOIN user
  WHERE tweet_id = ?;`
    const data = await db.all(queryreq, [tweetId])
    const userArray = data.map(each => each.username)
    response.send({likes: userArray})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticationCheck,
  userFollowingCheck,
  async (request, response) => {
    const {tweetId} = request.params
    const queryreq = `
  SELECT name, reply 
  FROM reply NATURAL JOIN user
  WHERE tweet_id = ?;`
    const data = await db.all(queryreq, [tweetId])
    response.send({replies: data})
  },
)

app.get('/user/tweets/', authenticationCheck, async (request, response) => {
  const {username} = request
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser.user_id

  const query = `
    SELECT tweet, COUNT() AS likes, date_time As dateTime
    FROM tweet INNER JOIN like
    ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`
  let likesData = await db.all(query)

  const repliesQuery = `
    SELECT tweet, COUNT() AS replies
    FROM tweet INNER JOIN reply
    ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`

  const repliesData = await db.all(repliesQuery)

  likesData.forEach(each => {
    for (let data of repliesData) {
      if (each.tweet === data.tweet) {
        each.replies = data.replies
        break
      }
    }
  })
  response.send(likesData)
})

//API 10
app.post('/user/tweets/', authenticationCheck, async (request, response) => {
  const {tweet} = request.body
  const {username} = request
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser.user_id

  const query = `
    INSERT INTO 
        tweet(tweet, user_id)
    VALUES ('${tweet}', ${userId});`
  await db.run(query)
  response.send('Created a Tweet')
})

//API 11
app.delete(
  '/tweets/:tweetId/',
  authenticationCheck,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = request
    const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
    const dbUser = await db.get(getUserQuery)
    const userId = dbUser.user_id

    const userTweetsQuery = `
    SELECT tweet_id, user_id 
    FROM tweet
    WHERE user_id = ${userId};`
    const userTweetsData = await db.all(userTweetsQuery)

    let isTweetUsers = false
    userTweetsData.forEach(each => {
      if (each['tweet_id'] == tweetId) {
        isTweetUsers = true
      }
    })

    if (isTweetUsers) {
      const query = `
        DELETE FROM tweet
        WHERE tweet_id = ${tweetId};`
      await db.run(query)
      response.send('Tweet Removed')
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

module.exports = app

