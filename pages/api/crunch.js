import { pexec, prepareFolder, uploadFile, complete, deleteBatch } from "../../utils";
import dropboxV2Api from 'dropbox-v2-api'

class Queue {
  q = []
  c = new Map()
  s = new Map()

  add(identifier, functionReturningPromise) {
    let existing = this.q.findIndex(([someId, _]) => {
      return someId === identifier
    })
    if ( existing !== -1 ) {
      return existing+1 // Already have one in q
    }
    console.log("Enqueing",identifier)
    this.q.push([identifier, functionReturningPromise])
    if (this.q.length === 1) {
      this.next()
    }
    console.log("Position",this.q.length)
    return this.q.length
  }

  next() {
    let first = this.q[0]
    if (!first) {
      console.log("Queue complete")
      return
    }
    let [identifier, op] = this.q[0]
    console.log("Starting",identifier)
    op(message => {
      console.log(`Status [${identifier}]: ${message}`)
      this.s.set(identifier, message)
    })
    .then(result => {
      console.log(`Queue ${identifier} - SUCCESS`)
      this.c.set(identifier, [result, null] )
      this.q.shift()
      this.next()
    })
    .catch( error => {
      console.log(`Queue ${identifier} - Failure '${error}'`)
      this.c.set(identifier, [null, error])
      this.q.shift()
      this.next()
    })
  }
}

let queue = new Queue()

export default (req, res) => {
  let {
    body: bodyJSON,
  } = req
  let body = JSON.parse(bodyJSON)

  let {
    prefix,
    token,
    folder
  } = body

  if (queue.c.has(prefix)) {
    let [result, error] = queue.c.get(prefix)
    if (error) {
      console.log("ERROR",error)
      complete(res,null,JSON.stringify(error))
      queue.c.delete(prefix)
    } else {
      let {highlight, crunch} = result
      console.log("SUCCESS")
      complete(res, { 
        highlight: highlight,
        crunch: crunch
      }, error)
    }
    return
  }

  let pos = queue.add(prefix, status => {
    status("Downloading...")
    let dropbox = dropboxV2Api.authenticate({
      token: token
    })

    return prepareFolder(body)
    .then(info => {
      let { frontPath, leftPath, rightPath, vidDir } = info
      status("Crunching...")
      // Generate crunch and highlight
      let highlightTemp = `${vidDir}/${prefix}-highlight-temp.gif`
      let crunchTemp = `${vidDir}/${prefix}-crunch-temp.mp4`
      let highlightPath = `${vidDir}/${prefix}-highlight.gif`
      let crunchPath = `${vidDir}/${prefix}-crunch.mp4`
      info.crunchPath = crunchPath
      info.highlightPath = highlightPath
      return pexec(`if [ ! -f ${crunchPath} -a ! -f ${highlightPath} ]; then \
        ffmpeg -y -i ${rightPath} -i ${frontPath} -i ${leftPath} -nostdin -filter_complex \
        "[0:v][1:v]hstack[lf];[lf][2:v]hstack[lfr];[lfr]split[full][f];[f]select=gt(scene\\,0.003),setpts=N/(16*TB)[bh];[bh]scale=w=600:h=150[hslow];[hslow]setpts=0.25*PTS[highlight]" \
        -map "[full]" -pix_fmt yuv420p ${crunchTemp} -map "[highlight]" -pix_fmt yuv420p ${highlightTemp}; \n
        mv ${crunchTemp} ${crunchPath}; mv ${highlightTemp} ${highlightPath}; fi
      `).then(_ => {
        return info
      })
    })
    .then( info => {
      let { highlightPath, crunchPath } = info
      status("Uploading result...")
      // Upload crunch and highlight
      return Promise.all([
        uploadFile(dropbox,`${folder}/${prefix}-highlight.gif`,highlightPath),
        uploadFile(dropbox,`${folder}/${prefix}-crunch.mp4`,crunchPath)
      ]).then(([highlight, crunch]) => {
        info.highlight = highlight
        info.crunch = crunch
        return info
      })
    })
    .then(info => {
      let { front, left, right } = body
      status("Deleting old files...")
      return deleteBatch(dropbox,["front","left_repeater","right_repeater"].map(suffix => {
        return `${folder}/${prefix}-${suffix}.mp4`
      }))
      .then(_ => {
        return info
      })
    })
  })

  res.statusCode = 206
  res.setHeader('Content-Type', 'application/json') 
  let response = {
    queue: pos
  }

  if (queue.s.has(prefix)) {
    response.status = queue.s.get(prefix)
  }
  res.end(JSON.stringify(response))
}
