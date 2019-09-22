import { pexec, prepareFolder, uploadFile, complete } from "../../utils";
import dropboxV2Api from 'dropbox-v2-api'

export default (req, res) => {
  let {
    body: bodyJSON,
  } = req

  let body = JSON.parse(bodyJSON)
  let {
    prefix,
    token,
    target
  } = body
  
  res.statusCode = 500 // default
  
  var previewPath = null
  let dropbox = dropboxV2Api.authenticate({
    token: token
  })
  
  prepareFolder(body).then( ({ frontPath, leftPath, rightPath, vidDir }) => {
    console.log("FRONTPATH:",frontPath)
    previewPath = `${vidDir}/${prefix}-preview.png`
    return pexec(`if [ ! -f ${previewPath} ]; then ffmpeg -y -i ${rightPath} -i ${frontPath} -i ${leftPath} -nostdin -loglevel panic -filter_complex \
    "[0:v][1:v]hstack[lf];[lf][2:v]hstack[lfr];[lfr]scale=w=600:h=150" \
     -vframes 1 ${previewPath}; fi`).then(_ => {
       console.log("Preview Generated:",previewPath)
     })
  })
  .then(_ => {
    return uploadFile(dropbox, target, previewPath)
  })
  .then(result, error => {
    if (error) {
      complete(res, nil, error)
    } else {
      complete(res, { preview: result }, error)
    }
  })
}