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
    folder
  } = body
  
  res.statusCode = 500 // default
  
  let dropbox = dropboxV2Api.authenticate({
    token: token
  })
  
  prepareFolder(body).then( ({ frontPath, leftPath, rightPath, vidDir }) => {
    let previewPath = `${vidDir}/${prefix}-preview.png`
    return pexec(`if [ ! -f ${previewPath} ]; then ffmpeg -y -i ${rightPath} -i ${frontPath} -i ${leftPath} -nostdin -loglevel panic -filter_complex \
    "[0:v][1:v]hstack[lf];[lf][2:v]hstack[lfr];[lfr]scale=w=600:h=150" \
     -vframes 1 ${previewPath}; fi`).then(_ => {
       console.log("Preview Generated:",previewPath)
     }).then(_ => {
       return previewPath
     })
  })
  .then(previewPath => {
    console.log("Uploading",previewPath)
    return uploadFile(dropbox, `${folder}/${prefix}-preview.png`, previewPath)
  })
  .then(result => {
    complete(res, { preview: result }, null)
  })
  .catch(error => {
    complete(res, null, error)
  })
}