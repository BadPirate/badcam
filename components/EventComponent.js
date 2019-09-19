import React from 'react';
import { Alert, Button, ButtonGroup, Container } from 'react-bootstrap';

/** @typedef {typeof import('dropbox')} Dropbox */

export class EventComponent extends React.Component {
  state={
    preview: null,
    message: "Loading...",
    variant: "info",
    invalid: false,
    buttons: null
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
        { buttons ?
          <ButtonGroup>
            {buttons}
          </ButtonGroup> : null }
      </Container>
    );
  }

  componentDidMount() {
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
            buttons: (state.buttons || []).concat(
              <Button>Generate Preview</Button>
            )
          }
        })
      } else {
        this.setState({
          invalid: true
        })
      }
    }
  }
}
