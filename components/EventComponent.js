import React from 'react';
import { Alert, Button, ButtonGroup, Container } from 'react-bootstrap';

/** @typedef {typeof import('dropbox')} Dropbox */

export class EventComponent extends React.Component {
  state={
    preview: null,
    message: "Loading...",
    variant: "info",
    invalid: false,
    buttons: []
  }

  render() {
    if (this.state.invalid) return null
    let event = this.props.event
    let message = this.state.message
    let variant = this.state.variant
    let preview = this.state.preview
    let buttons = this.state.buttons

    return (
      <Container>
        <p>{event.prefix}</p>
        { message ? <Alert variant={variant}>{message}</Alert> : null }
        { preview ? <img src={preview.link}/> : null }
        { buttons.length > 0 ?
          <ButtonGroup>
            {buttons}
          </ButtonGroup> : null }
      </Container>
    );
  }

  componentDidMount() {
    this.loadPreview()
  }

  loadPreview() {
     /** @param Dropbox box */
     let box = this.props.box
     let event = this.props.event
 
     if (event.preview) {
       this.setState({
         message: "Loading preview...",
         variant: "info"
       })
       box.filesGetTemporaryLink({ path: event.preview.path_lower}).then( result => {
         this.setState({
           message: null,
           variant: null,
           preview: result
         })
       })
     } else {
       // No preview
       if (event.hasOriginals()) {
         this.setState( state => {
           return {
             message: null,
             variant: null,
             buttons: state.buttons.concat(
               <Button key="generate_preview" onClick={ element => {
                 this.generatePreview()
               }}>
                 Generate Preview
               </Button>
             )
           }
         })
       } else {
         this.setState({
           message: "Incomplete",
           variant: "warning"
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
        buttons: state.buttons.filter(button => {
          button.key !== "generate_preview"
        })
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
          this.loadPreview()
        } else {
          response.text().then(text => {
            this.setState({
              message: `Error - ${text}`,
              variant: "danger"
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
