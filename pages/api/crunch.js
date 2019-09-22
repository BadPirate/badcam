import { pexec, prepareFolder, uploadFile, complete } from "../../utils";
import dropboxV2Api from 'dropbox-v2-api'

class Queue {
  q = []

  add(identifier, functionReturningPromise) {
    let existing = this.q.findIndex(([someId, _]) => {
      return someId === identifier
    })
    if ( existing !== -1 ) return existing // Already have one in q
    this.q.push([identifier, functionReturningPromise])
    if (this.q.length === 1) {
      this.next()
    }
    return this.q.length
  }

  next() {
    let [_, next] = this.q[0]
    if (next) {
      next().finally(_ => {
        this.q.shift()
        this.next()
      })
    }
  }
}

let queue = new Queue()

export default (req, res) => {
  let {
    body: bodyJSON,
  } = req
  let body = JSON.parse(bodyJSON)

  queue.add(_ => {
    let {
      prefix,
      token,
      folder
    } = body

    let dropbox = dropboxV2Api.authenticate({
      token: token
    })

    return prepareFolder(body)
    .then(info => {
      let { frontPath, leftPath, rightPath, vidDir } = info
      // Generate crunch and highlight
      let highlightPath = `${vidDir}/${prefix}-highlight.gif`
      let crunchPath = `${vidDir}/${prefix}-crunch.mp4`
      return pexec(`
        ffmpeg -y -i ${rightPath} -i ${frontPath} -i ${leftPath} -nostdin -loglevel panic -filter_complex \
        "[0:v][1:v]hstack[lf];[lf][2:v]hstack[lfr];[lfr]split[full][f];[f]select=gt(scene\,0.003),setpts=N/(16*TB)[bh];[bh]scale=w=600:h=150[highlight]" \
        -map "[full]" -pix_fmt yuv420p ${crunchPath} -map "[highlight]" -pix_fmt yuv420p ${highlightPath}
      `).then(_ => {
        info.crunchPath = crunchPath
        info.highlightPath = highlightPath
        return info
      })
    })
    .then( info => {
      let { highlightPath, crunchPath } = info
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
      return deleteBatch(dropbox,[front,left,right])
      .then(_ => {
        return info
      })
    })
    .then(info, error => {
      if (error) {
        complete(res,null,error)
      } else {
        let {highlight, crunch}  = info
        complete(res, { 
          highlight: highlight,
          crunch: crunch
        }, error)
      }
    })
  })
}
