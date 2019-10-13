import { exec } from "child_process";
import fs from 'fs'

let basedir = pexec('r=$(dirname $(mktemp -u))"/badcam";mkdir -p $r;echo $r')

export function pexec(cmd, fail = "") {
  if (!fail) fail = `${cmd} failed`
  console.log("[Executing] ",cmd)
  return new Promise((resolve, reject) => {
    try {
      exec(`${cmd} || (echo "${fail}" >&2; exit 2)`, (error, stdout, stderr) => {
        if (stderr && error) {
          reject({
            error: stderr,
            cmd: cmd
          })
        }
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
    } catch (error) {
      reject(error)
    }
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
      return pexec(`if [ ! -f ${filepath} ]; then curl -s ${url} --output ${filepath}; fi`)
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
    try {
      dropbox({
        resource: 'files/upload',
        parameters: {
            path: target
        },
        readStream: fs.createReadStream(path)
      }, (err, result, _) => {
        console.log("Upload result:", err, result)
        if (err) {
          reject(`Dropbox Upload Error: ${JSON.stringify(err) || err}`)
        } else {
          resolve(result)
        }
      })
    } catch (e) {
      reject(e)
    }
    
})}

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
        console.log("Delete rejection",err)
        reject(`Dropbox Delete Error: ${JSON.stringify(err) || err}`)
      } else {
        resolve(result)
      }
  })})
}

export function success(success,res) {
  console.log("Success")
  res.status(200).json(success)
}

export function failure(error,res) {
  console.log("Error", error)
  res.status(500).json({
    result: "Error",
    error: error
  })
}

export function verify(path) {
  console.log("Checking",path)
  return new Promise((resolve, reject) => {
    fs.access(path, fs.F_OK, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve(path)
      }
    })})
} 