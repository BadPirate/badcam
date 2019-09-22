import React from 'react';
import { Alert, Button, ButtonGroup, Container } from 'react-bootstrap';

/** @typedef {typeof import('dropbox')} Dropbox */

export class EventComponent extends React.Component {
  state={
    preview: null,
    message: "Loading...",
    variant: "info",
    invalid: false,
    generating: false,
  }

  render() {
    if (this.state.invalid) return null
    let event = this.props.event
    let message = this.state.message
    let variant = this.state.variant
    let preview = this.state.preview
    let buttons = this.buttons()

    return (
      <Container>
        <p>{event.prefix}</p>
        { message ? <Alert variant={variant}>{message}</Alert> : null }
        { preview ? <img src={preview.link} width="100%"/> : null }
        { buttons.length > 0 ?
          <ButtonGroup>
            {buttons}
          </ButtonGroup> : null }
      </Container>
    );
  }

  buttons() {
    let event = this.props.event
    let generating = this.state.generating

    let buttons = []
    if (!generating && event.left && event.right && event.front && !event.preview) {
      buttons.push(
        <Button key="generate_preview" onClick={ _ => {
          this.generatePreview()
        }}>
          Generate Preview
        </Button>
      )
    }
    if (event.left || event.right || event.front || event.highlight || event.crunch || event.preview) {
      buttons.push(
        <Button key="delete" variant="danger" onClick={ _ => {
          this.setState(state => {
            return {
              message: "Deleting...",
              variant: "danger",
              buttons: []
            }
          })
          let box = this.props.box
          Promise.all([
            event.front,
            event.left,
            event.right,
            event.highlight,
            event.crunch,
            event.preview
          ].map(possible => {
            if (possible) {
              return box.filesDelete({ path: possible.path_lower })
            }
          }))
          .then(_ => {
            this.setState({
              invalid: true
            })
          })
          .catch(error => {
            this.setState({
              message: JSON.stringify(error),
              variant: "danger"
            })
          })
        }}>
          Delete
        </Button>
      )
    }

    return buttons
  }

  componentDidMount() {
    this.loadPreview()
  }

  loadPreview() {
     /** @param Dropbox box */
     let box = this.props.box
     let event = this.props.event

     // Load Preview / Highlight
     if (event.highlight) {
       this.setState({
         message: "Loading highlight...",
         variant: "info"
       })
       box.filesGetTemporaryLink({ path: event.highlight.path_lower}).then( result => {
        this.setState({
          message: null,
          variant: null,
          preview: result,
          generating: false
        })
      })
     } else if (event.preview) {
       this.setState({
         message: "Loading preview...",
         variant: "info"
       })
       box.filesGetTemporaryLink({ path: event.preview.path_lower}).then( result => {
         this.setState({
           message: null,
           variant: null,
           preview: result,
           generating: false
         })
       })
     } else {
       // No preview
       if (!event.hasOriginals()) {
         this.setState({
           message: "Incomplete (Still uploading?)",
           variant: "warning"
         })
       } else {
         this.setState({
           message: null,
           variant: null
         })
       }
     }
  }

  generatePreview() {
    let box = this.props.box
    let event = this.props.event
    let account = this.props.account

    this.setState(state => {
      return {
        message: "Generating Preview...",
        variant: "info",
        generating: true
      }
    })
    var size = 0
    let uploadPath = `${event.folder}/${event.prefix}-preview.png`
    console.log("UPLOADPATH",uploadPath)
    Promise.all([event.front, event.left, event.right].map(resource => {
      size += resource.size
      return new Promise( (resolve, _) => {
        box.filesGetTemporaryLink({path: resource.path_lower}).then( result => {
          resolve(result.link)
        })
      })
    })).then(links => {
      let [front, left, right] = links
      fetch('api/preview', {
        method: "POST",
        body: JSON.stringify({
          front: front,
          left: left,
          right: right,
          size: size,
          prefix: event.prefix,
          user: account.account_id,
          token: localStorage.getItem('access'),
          target: uploadPath
        })
      }).then((response) => {
        if (response.status == 200) {
          response.json().then(json => {
            console.log("JSON:",json)
            this.props.event.preview = json.preview
            this.loadPreview()
          })
        } else {
          response.text().then(text => {
            this.setState({
              message: `Error - ${text}`,
              variant: "danger",
              generating: false
            })
          })
        }
      }).catch(error => {
        console.log("FAILURE",error)
        this.setState({
          message: JSON.stringify(error),
          variant: "danger"
        })
      })
    })
  }
}
