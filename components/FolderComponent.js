import React from 'react'
import { Alert } from 'react-bootstrap';

/** @typedef {typeof import('dropbox')} Dropbox*/

export class FolderComponent extends React.Component {
  state={
    message: "Loading...",
    variant: "info",
    preview: null
  }

  render() {
    let folder = this.props.folder
    let message = this.state.message
    let variant = this.state.variant
    let preview = this.state.preview

    if (folder[".tag"] != "folder") return null
    let regex = /(\d\d\d\d)-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)/
    let nameParts = regex.exec(folder.name)
    if (nameParts.length < 7) return null
    let [_, year, month, day, hour, minute, second] = nameParts
    return (
      <tr>
        <td>{`${year}-${month}-${day}`}</td>
        <td>{`${hour}:${minute}.${second}`}</td>
        <td>
        { message ? <Alert variant={variant}>{message}</Alert> : null}
        { preview ? <img src={preview}/> : null }
        </td>
      </tr>
    );
  }

  componentDidMount() {
    /** @param Dropbox box */
    let box = this.props.box
    let folder = this.props.folder

    box.filesListFolder({path: folder.path_lower}).then( (result, error) => {
      if (error) {
        this.setState({
          message: "Unable to load folder",
          variant: "danger"
        })
        return
      }
      var found = false
      result.entries.forEach(file => {
        if (file.name.endsWith("preview.png")) {
          found = true
          box.filesGetTemporaryLink({path: file.path_lower}).then( (result, error) => {
            if (error) {
              this.setState({
                message: "Unable to load preview",
                variant: "danger"
              })
              return
            }
            this.setState({
              message: null,
              variant: null,
              preview: result.link
            })
          })
        }
      })
      if (!found) {
        this.setState({
          message: "Generating preview...",
          variant: "info"
        })
      }
    })
  }
}
