import { pexec, prepareFolder, uploadFile, deleteBatch, failure, success } from "../../utils";
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
      queue.c.delete(prefix)
      failure(error,res)
    } else {
      let {highlight, crunch} = result
      console.log("SUCCESS")
      success({ 
        highlight: highlight,
        crunch: crunch
      }, res)
    }
    return
  }

  let pos = queue.add(prefix, status => {
    status("Downloading...")
    let dropbox = dropboxV2Api.authenticate({
      token: token
    })

    var prepareInfo
    var shrunkPaths = []
    return prepareFolder(body)
    .then(info => {
      prepareInfo = info
      status("Compressing...")
      return compress(status, prepareInfo.leftPath, shrunkPaths)
    }).then(_ => {
      return compress(status, prepareInfo.frontPath, shrunkPaths)
    }).then(_ => {
      return compress(status, prepareInfo.rightPath, shrunkPaths)
    })
    .then(_ => {
      let info = prepareInfo
      let {vidDir} = info
      status("Crunching...")
      // Generate crunch and highlight
      let highlightTemp = `${vidDir}/${prefix}-highlight-temp.gif`
      let crunchTemp = `${vidDir}/${prefix}-crunch-temp.mp4`
      let highlightPath = `${vidDir}/${prefix}-highlight.gif`
      let crunchPath = `${vidDir}/${prefix}-crunch.mp4`
      info.crunchPath = crunchPath
      info.highlightPath = highlightPath
      return pexec(`if [ ! ${crunchPath} -a ! -f ${highlightPath} ]; then exit; fi; \
        ffmpeg -hide_banner -y -i ${shrunkPaths[0]} -i ${shrunkPaths[1]} -i ${shrunkPaths[2]} -nostdin -filter_complex \
        "[0:v][1:v]hstack[lf];[lf][2:v]hstack[lfr];[lfr]split[full][f];[f]select=gt(scene\\,0.003),setpts=N/(16*TB)[bh];[bh]scale=w=600:h=150[highlight]" \
        -map "[full]" -pix_fmt yuv420p ${crunchTemp} -map "[highlight]" -pix_fmt yuv420p ${highlightTemp} \
        || (echo "Unable to crunch" >&2; exit 1); \
        mv ${crunchTemp} ${crunchPath}; mv ${highlightTemp} ${highlightPath}`, "No crunch output file present").then(_ => {
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
      status("Deleting old files...")
      return deleteBatch(dropbox,["front","left_repeater","right_repeater"].map(suffix => {
        return `${folder}/${prefix}-${suffix}.mp4`
      }))
      .then(_ => {
        return info
      })
    })
    .then(info => {
      let {vidDir} = info
      if (vidDir) {
        status("Cleaning up server...")
        return pexec(`rm -rf ${vidDir}`).then(_ => {return info})
      }
      return info
    })
  })

  res.status(206).json({
    queue: pos,
    status: queue.s.has(prefix) ? queue.s.get(prefix) : `Queued ${pos}`
  })
}

async function compress(status, path, shrunkPaths) {
  status(`Compressing ${path}`);
  let shrunk = `${path}.shrunk.mp4`;
  let temp = `${path}.shrunk.temp.mp4`;
  shrunkPaths.push(shrunk);
  return await pexec(`if [ -f "${shrunk}" ]; then exit; fi
          ffmpeg -i "${path}" -hide_banner -nostdin -loglevel panic -s 320x240 -c:a copy "${temp}" \
          || (echo "Unable to compress" >&2; exit 1)
          mv "${temp}" "${shrunk}"`, "No compress output file");
}

