import { pexec } from "../../utils";
import dropboxV2Api from 'dropbox-v2-api'
import fs from 'fs'

let basedir = pexec('r=$(dirname $(mktemp -u))"/badcam";mkdir -p $r;echo $r')

export default (req, res) => {
  let {
    body: body,
  } = req

  let {
    front,
    left,
    right,
    size,
    prefix,
    user,
    token,
    target
  } = JSON.parse(body)
  console.log("PREFIX", prefix)
  console.log("TOKEN", token)
  
  res.statusCode = 500 // default
  
  var vidDir = null
  var previewPath = null
  let dropbox = dropboxV2Api.authenticate({
    token: token
  })
  basedir.then(({stdout}) => {
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
    console.log("Space available:",spaceAvailable)
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
      return pexec(`if [ ! -f ${filepath} ]; then curl ${url} --output ${filepath}; fi`).then(_ => {
        return filepath
      })
    }))
  })
  .then((result) => {
    console.log("Downloaded",result)
    let [frontPath, leftPath, rightPath] = result
    previewPath = `${vidDir}/${prefix}-preview.png`
    return pexec(`if [ ! -f ${previewPath} ]; then ffmpeg -y -i ${rightPath} -i ${frontPath} -i ${leftPath} -nostdin -loglevel panic -filter_complex \
    "[0:v][1:v]hstack[lf];[lf][2:v]hstack[lfr];[lfr]scale=w=600:h=150" \
     -vframes 1 ${previewPath}; fi`).then(_ => {
       console.log("Preview Generated:",previewPath)
     })
  })
  .then(_ => {
    return new Promise((resolve, reject) => {
      dropbox({
        resource: 'files/upload',
        parameters: {
            path: target
        },
        readStream: fs.createReadStream(previewPath)
      }, (err, result, _) => {
        if (err) {
          reject(`Dropbox Upload Error: ${err.error_summary}`)
        } else {
          resolve(result)
        }
    })})
    // let curl = `curl -X POST "${upload}" --header "Content-Type: application/octet-stream" --data-binary "@${previewPath}"`
    // console.log("Curling",curl)
    // return pexec(curl)
  })
  .then(result => {
    console.log("Success")
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json') 
    let out = { preview: result }
    console.log("OUT:",out)
    res.end(JSON.stringify(out))
  })
  .catch( e => {
    console.log("Error: ",e)
    res.setHeader('Content-Type', 'text/plain')
    res.end(e)
  })
}

// ffmpeg -y -i $right -i $front -i $left -nostdin -loglevel panic -filter_complex "[0:v][1:v]hstack[lf];[lf][2:v]hstack[lfr];[lfr]split[full][f];[f]select=gt(scene\,0.003),setpts=N/(16*TB)[bh];[bh]scale=w=600:h=150[highlight]" -map "[full]" -pix_fmt yuv420p $crunch -map "[highlight]" -pix_fmt yuv420p $highlight
