import { exec } from "child_process";
import fs from 'fs'

let basedir = pexec('r=$(dirname $(mktemp -u))"/badcam";mkdir -p $r;echo $r')

export function pexec(cmd) {
  console.log("[Executing] ",cmd)
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      }
      else {
        resolve({
          stdout: stdout.replace(/^\s+|\s+$/g, ''),
          stderr: stderr.replace(/^\s+|\s+$/g, '')
        })
      }
    })
  })
}

export function prepareFolder({ prefix, user, front, left, right, size }) {
  var vidDir = null
  return basedir.then(({stdout}) => {
    // Create the vid dir if needed
    let baseDir = stdout
    let userDir = `${baseDir}/${user}`
    vidDir = `${userDir}/${prefix}`
    return pexec(`mkdir -p ${userDir}; mkdir -p ${vidDir}`)
  })
  .then( _ => {
    // Check space available
    return pexec(`df -k ${vidDir} | grep -v used | awk '{ print $4 "\\t" }'`)
  })
  .then(({stdout}) => {
    let spaceAvailable = stdout
    if (spaceAvailable < size) {
      res.statusCode = 507
      throw "Insufficient server space"
    }
    return Promise.all([
      ["front", front],
      ["left_repeater", left],
      ["right_repeater", right]
    ].map(([file, url]) => {
      let filepath = `${vidDir}/${prefix}-${file}.mp4`
      return pexec(`if [ ! -f ${filepath} ]; then curl ${url} --output ${filepath}; fi`)
      .then(_ => { return filepath })
    }))
  })
  .then((paths) => {
    let [frontPath, leftPath, rightPath ] = paths
    return {
      frontPath: frontPath,
      leftPath: leftPath,
      rightPath: rightPath,
      vidDir: vidDir
    }
  })
}

export function uploadFile(dropbox, target, path) {
  return new Promise((resolve, reject) => {
    dropbox({
      resource: 'files/upload',
      parameters: {
          path: target
      },
      readStream: fs.createReadStream(path)
    }, (err, result, _) => {
      console.log("Dropbox upload result",err,result)
      if (typeof err !== 'undefined' && err !== null) {
        reject(`Dropbox Upload Error: ${JSON.stringify(err)}`)
      } else {
        resolve(result)
      }
  })})
}

export function deleteBatch(dropbox, targets) {
  return new Promise((resolve, reject) => {
    dropbox({
      resource: 'files/delete_batch',
      parameters: {
        entries: targets.map(target => {
          return {
            path: target
          }
        })
      }
    }, (err, result, _) => {
      if (err) {
        reject(`Dropbox Upload Error: ${err.error_summary}`)
      } else {
        resolve(result)
      }
  })})
}

export function complete(res, out, error) {
  if (error) {
    console.log("Error: ",error)
    res.setHeader('Content-Type', 'text/plain')
    res.statusCode = 500
    res.end(error)
    return
  }
  console.log("Success")
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json') 
  console.log("OUT:",out)
  res.end(JSON.stringify(out))
}