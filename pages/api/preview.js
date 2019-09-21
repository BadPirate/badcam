import { pexec } from "../../utils";

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
    upload
  } = JSON.parse(body)
  console.log("PREFIX", prefix)
  console.log("UPLOAD", upload)
  
  res.setHeader('Content-Type', 'text/plain')
  res.statusCode = 500 // default
  
  var vidDir = null
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
    let previewPath = `${vidDir}/${prefix}-preview.png`
    return pexec(`if [ ! -f ${previewPath} ]; then ffmpeg -y -i ${rightPath} -i ${frontPath} -i ${leftPath} -nostdin -loglevel panic -filter_complex \
    "[0:v][1:v]hstack[lf];[lf][2:v]hstack[lfr];[lfr]scale=w=600:h=150" \
     -vframes 1 ${previewPath}; fi`).then(_ => {
       console.log("Preview Generated:",previewPath)
       return previewPath
     })
  })
  .then(previewPath => {
    let curl = `curl -X POST "${upload}" --header "Content-Type: application/octet-stream" --data-binary "@${previewPath}"`
    console.log("Curling",curl)
    return pexec(curl)
  })
  .then(res => {
    let json = null
    try {
      json = JSON.parse(res.stdout)
    } catch (error) {
      // ignore
    }
    if (!json) {
      throw `Curl failed - ${res.stdout}`
    }
    console.log("Uploaded",res)
  })
  .then(_ => {
    console.log("Success")
    res.statusCode = 200
    res.end("Generated preview")
  })
  .catch( e => {
    console.log("Error: ",e)
    res.end(e)
  })
}

