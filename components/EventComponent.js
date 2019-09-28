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
    let box = this.props.box

    let buttons = []
    if (!generating && event.hasOriginals() && (!event.preview && !event.highlight)) {
      buttons.push(
        <Button key="generate_preview" onClick={ _ => {
          this.generatePreview()
        }}>
          Quick Preview
        </Button>
      )
    }
    if (!generating && event.hasOriginals() && !event.crunch) {
      buttons.push(
        <Button key="crunch" onClick={ _ => {
          this.crunch()
        }}>
          Crunch
        </Button>
      )
    }
    ['left','right','front','crunch'].forEach(name => {
      let vid = event[name]
      if (!vid) return
      buttons.push(
        <Button key={name} variant="secondary" onClick={_ => {
          box.filesGetTemporaryLink({ path: vid.path_lower }).then(result => {
            window.location.href = result.link
          })
        }}>
          Download {name}
        </Button>
      )
    })
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

  crunch() {
    let box = this.props.box
    let event = this.props.event
    let account = this.props.account

    this.setState({
      message: "Crunching... (this could take a while)",
      variant: "info",
      generating: true
    })
    this.crunchCall(event, box, account);
  }
  
  crunchCall(event, box, account) {
    event.links(box).then(info => {
      info.user = account.account_id;
      fetch('api/crunch', {
        method: "POST",
        body: JSON.stringify(info)
      })
        .then(response => {
          if (response.status == 206) {
            response.json().then(({ queue, status }) => {
              let message = status || `Enqueued - Position ${queue}`
              this.setState({
                message: message
              });
              setTimeout(_ => {
                this.crunchCall(event, box, account)
              }, 1000);
            });
          }
          else if (response.status == 200) {
            response.json().then(json => {
              let { highlight, crunch } = json;
              this.props.event.highlight = highlight;
              this.props.event.crunch = crunch;
              this.props.event.left = null;
              this.props.event.right = null;
              this.props.event.front = null;
              this.loadPreview();
            });
          }
          else {
            response.text().then(text => {
              this.setState({
                message: `Error - ${text}`,
                variant: "danger",
                generating: false
              });
            });
          }
        })
        .catch(error => {
          this.setState({
            message: JSON.stringify(error),
            variant: "danger",
            generating: false
          });
        });
    });
  }

  generatePreview() {
    let box = this.props.box
    let event = this.props.event
    let account = this.props.account

    this.setState({
        message: "Generating Preview...",
        variant: "info",
        generating: true
    })
    event.links(box)
    .then(result => {
      result.user = account.account_id
      fetch('api/preview', {
        method: "POST",
        body: JSON.stringify(result)
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
          variant: "danger",
          generating: false
        })
      })
    })
  }
}
