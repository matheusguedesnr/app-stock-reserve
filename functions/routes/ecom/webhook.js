// read configured E-Com Plus app data
const { firestore } = require('firebase-admin')
const getAppData = require('./../../lib/store-api/get-app-data')
const ecomClient = require('@ecomplus/client')

const SKIP_TRIGGER_NAME = 'SkipTrigger'
const ECHO_SUCCESS = 'SUCCESS'
const ECHO_SKIP = 'SKIP'
const ECHO_API_ERROR = 'STORE_API_ERR'

exports.post = async ({ appSdk, admin }, req, res) => {
  // receiving notification from Store API
  const { storeId } = req

  /**
   * Treat E-Com Plus trigger body here
   * Ref.: https://developers.e-com.plus/docs/api/#/store/triggers/
   */
  const trigger = req.body
  appSdk.getAuth(storeId)
    .then((auth) => {
      return getAppData({ appSdk, storeId, auth })
        .then(appData => {
          if (
            Array.isArray(appData.ignore_triggers) &&
            appData.ignore_triggers.indexOf(trigger.resource) > -1
          ) {
            // ignore current trigger
            const err = new Error()
            err.name = SKIP_TRIGGER_NAME
            throw err
          }

          /* DO YOUR CUSTOM STUFF HERE */
          let docId, isCart
          console.log('Deu certo auth')
          if (trigger.action !== 'delete') {
            docId = trigger.resource_id || trigger.inserted_id
            isCart = trigger.resource === 'carts'
          }
          console.log(`> Webhook #${storeId} ${docId} [${trigger.resource}]`)
          if (docId && isCart) {
            const docEndpoint = `carts/${docId}.json`
            return appSdk.apiRequest(storeId, docEndpoint).then(async ({ response }) => {
              const doc = response.data
              const { completed } = doc
              const documentRef = admin.firestore().doc(`cart_reserve/${docId}`)
              const documentSnapshot = await documentRef.get()
              if (completed) {
                await documentRef.delete()
                if (!res.headersSent) {
                  // done
                  return res.status(201).send(ECHO_SUCCESS)
                }
              }
              const products = []
              const uniqueProducts = doc.items.filter((obj, index) => {
                return index === doc.items.findIndex(o => obj.product_id === o.product_id);
              });
              for (let index = 0; index < uniqueProducts.length; index++) {
                const { data } = await ecomClient.store({ url: `/products/${uniqueProducts[index].product_id}.json`, authenticationId: auth.myId, accessToken: auth.accessToken, method: 'get', storeId})
                if (data) {
                  products.push(data)
                }
              }
              if (!documentSnapshot.exists) {
                for (let index = 0; index < doc.items.length; index++) {
                  const item = doc.items[index];
                  const indexProduct = products.findIndex(({ _id }) => _id === item.product_id)
                  if (indexProduct >= 0) {
                    endpoint = `/products/${item.product_id}.json`
                    let quantity, metafield, metafieldIndex
                    const hitProduct = products[indexProduct]
                    if (hitProduct.variations && hitProduct.variations.length) {
                      const variation = hitProduct.variations.find(({ _id }) => _id === item.variation_id)
                      quantity = variation.quantity
                      metafields = hitProduct.metafields
                      if (metafields && metafields.length) {
                        metafieldIndex = metafields.findIndex(field => field.namespace === item.variation_id)
                        if (metafieldIndex >= 0) {
                          metafield = metafields[metafieldIndex]
                          quantity = Number(metafield.value)
                        }
                      } else {
                        hitProduct.metafields = []
                      }
                      quantity -= item.quantity
                      quantity >= 0 ? quantity : quantity = 0
                      console.log(`#${storeId} - ${endpoint} - ${quantity}`)
                      if (metafields && metafields.length && metafieldIndex >= 0) {
                        metafields[metafieldIndex].value = String(quantity)
                      } else {
                        hitProduct.metafields.push({
                          _id: item.variation_id,
                          namespace: item.variation_id,
                          field: 'quantity',
                          value: String(quantity)
                        })
                      }
                    } else {
                      quantity = hitProduct && hitProduct.quantity || 0
                      quantity >= 0 ? quantity : quantity = 0
                      metafields = hitProduct.metafields
                      if (metafields && metafields.length) {
                        metafieldIndex = metafields.findIndex(field => field.namespace === item.product_id)
                        if (metafieldIndex >= 0) {
                          metafield = metafields[metafieldIndex]
                          quantity = Number(metafield.value)
                        }
                      } else {
                        hitProduct.metafields = []
                      }
                      quantity -= item.quantity
                      quantity >= 0 ? quantity : quantity = 0
                      console.log(`#${storeId} - ${endpoint} - ${quantity}`)
                      if (metafields && metafields.length && metafieldIndex >= 0) {
                        metafields[metafieldIndex].value = String(quantity)
                      } else {
                        hitProduct.metafields.push({
                          _id: item.variation_id,
                          namespace: item.variation_id,
                          field: 'quantity',
                          value: String(quantity)
                        })
                      }
                    }
                    await appSdk.apiRequest(storeId, endpoint, 'PATCH', { metafields: products[indexProduct].metafields }, auth)
                  }
                }
                await documentRef.set({
                  storeId,
                  items: doc.items,
                  completed,
                  queuedAt: admin.firestore.Timestamp.now()
                })
                if (!res.headersSent) {
                  // done
                  return res.status(201).send(ECHO_SUCCESS)
                }
              } else {
                const { storeId, items, completed, queuedAt } = documentSnapshot.data()
                const diffItems = []
                doc.items.forEach(item => {
                  let quantityItem
                  items.forEach(itemDoc => {
                    if (item.product_id === itemDoc.product_id && item.variation_id === itemDoc.variation_id) {
                      quantityItem = (item.quantity - itemDoc.quantity) || 0
                      if (quantityItem !== 0) {
                        diffItems.push({
                          ...item,
                          quantity: quantityItem
                        })
                      }
                    }
                  }) 
                });

                if (diffItems.length) {
                  for (let index = 0; index < diffItems.length; index++) {
                    const item = diffItems[index];
                    const indexProduct = products.findIndex(({ _id }) => _id === item.product_id)
                    if (indexProduct >= 0) {
                      let endpoint = `/products/${item.product_id}.json`
                      let quantity
                      const hitProduct = products[indexProduct]
                      if (hitProduct.variations && hitProduct.variations.length) {
                        const variation = hitProduct.variations.find(({ _id }) => _id === item.variation_id)
                        quantity = variation.quantity
                        metafields = hitProduct.metafields
                        if (metafields && metafields.length) {
                          metafieldIndex = metafields.findIndex(field => field.namespace === item.variation_id)
                          if (metafieldIndex >= 0) {
                            metafield = metafields[metafieldIndex]
                            quantity = Number(metafield.value)
                          }
                        } else {
                          hitProduct.metafields = []
                        }
                        quantity -= item.quantity
                        quantity >= 0 ? quantity : quantity = 0
                        console.log(`#${storeId} - ${endpoint} - ${quantity}`)
                        if (metafields && metafields.length && metafieldIndex >= 0) {
                          metafields[metafieldIndex].value = String(quantity)
                        } else {
                          hitProduct.metafields.push({
                            _id: item.variation_id,
                            namespace: item.variation_id,
                            field: 'quantity',
                            value: String(quantity)
                          })
                        }
                      } else {
                        quantity = hitProduct && hitProduct.quantity || 0
                        quantity -= item.quantity
                        quantity >= 0 ? quantity : quantity = 0
                        metafields = hitProduct.metafields
                        if (metafields && metafields.length) {
                          metafieldIndex = metafields.findIndex(field => field.namespace === item.product_id)
                          if (metafieldIndex >= 0) {
                            metafield = metafields[metafieldIndex]
                            quantity = Number(metafield.value)
                          }
                        } else {
                          hitProduct.metafields = []
                        }
                        quantity -= item.quantity
                        quantity >= 0 ? quantity : quantity = 0
                        console.log(`#${storeId} - ${endpoint} - ${quantity}`)
                        if (metafields && metafields.length && metafieldIndex >= 0) {
                          metafields[metafieldIndex].value = String(quantity)
                        } else {
                          hitProduct.metafields.push({
                            _id: item.variation_id,
                            namespace: item.variation_id,
                            field: 'quantity',
                            value: String(quantity)
                          })
                        }
                      }
                      await appSdk.apiRequest(storeId, endpoint, 'PATCH', { metafields: products[indexProduct].metafields }, auth)
                    }
                  }
                }

                const creationDate = queuedAt.toDate()
                const date = new Date(creationDate)
                const msDate = date.getTime() + 600000
                const dateNow = new Date()
                const msDateNow = dateNow.getTime()
                if (msDate > msDateNow) {
                  console.log('I can overwrite', JSON.stringify(doc.items), 'completed:', doc.completed)
                  await documentRef.set({
                    storeId,
                    items: doc.items,
                    completed: doc.completed,
                    queuedAt
                  })
                }
                if (!res.headersSent) {
                  // done
                  return res.status(201).send(ECHO_SUCCESS)
                }
              }
            }).catch(error => {
              console.error(error)
              const status = error.response
                ? error.response.status || 500 : 409
              return res.sendStatus(status)
            })
          }
          res.sendStatus(204)
        })
        .catch(err => {
          console.log('nao consegui acessar app', err)
      if (err.name === SKIP_TRIGGER_NAME) {
        // trigger ignored by app configuration
        res.send(ECHO_SKIP)
      } else if (err.appWithoutAuth === true) {
        const msg = `Webhook for ${storeId} unhandled with no authentication found`
        const error = new Error(msg)
        error.trigger = JSON.stringify(trigger)
        console.error(error)
        res.status(412).send(msg)
      } else {
        // console.error(err)
        // request to Store API with error response
        // return error status code
        res.status(500)
        const { message } = err
        res.send({
          error: ECHO_API_ERROR,
          message
        })
      }
    })
    })

    
}
